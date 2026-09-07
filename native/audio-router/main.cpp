#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mmdeviceapi.h>
#include <endpointvolume.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <wrl.h>
#include <wrl/implements.h>
#include <propvarutil.h>
#include <fcntl.h>
#include <io.h>

#include <atomic>
#include <cstdio>
#include <iostream>
#include <string>
#include <vector>

#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "mmdevapi.lib")
#pragma comment(lib, "propsys.lib")

using Microsoft::WRL::ComPtr;
using Microsoft::WRL::Make;
using Microsoft::WRL::RuntimeClass;
using Microsoft::WRL::RuntimeClassFlags;
using Microsoft::WRL::ClassicCom;
using Microsoft::WRL::FtmBase;

namespace {
constexpr UINT32 kSampleRate = 48000;
constexpr WORD kChannels = 2;
constexpr WORD kBitsPerSample = 16;
constexpr DWORD kPollMs = 4;
std::atomic_bool g_stop{false};

BOOL WINAPI consoleHandler(DWORD type) {
    if (type == CTRL_C_EVENT || type == CTRL_BREAK_EVENT || type == CTRL_CLOSE_EVENT ||
        type == CTRL_LOGOFF_EVENT || type == CTRL_SHUTDOWN_EVENT) {
        g_stop.store(true);
        return TRUE;
    }
    return FALSE;
}

std::wstring hrMessage(HRESULT hr) {
    wchar_t* buffer = nullptr;
    FormatMessageW(FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
        nullptr, hr, MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT), reinterpret_cast<wchar_t*>(&buffer), 0, nullptr);
    std::wstring result = buffer ? buffer : L"Unknown error";
    if (buffer) LocalFree(buffer);
    return result;
}

int fail(const wchar_t* context, HRESULT hr) {
    std::wcerr << L"MRD Audio Router: " << context << L" failed (0x" << std::hex << hr << L"): " << hrMessage(hr) << std::endl;
    return 1;
}

HRESULT getDefaultEndpointVolume(ComPtr<IAudioEndpointVolume>& volume) {
    ComPtr<IMMDeviceEnumerator> enumerator;
    HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator));
    if (FAILED(hr)) return hr;

    ComPtr<IMMDevice> device;
    hr = enumerator->GetDefaultAudioEndpoint(eRender, eMultimedia, &device);
    if (FAILED(hr)) return hr;

    return device->Activate(__uuidof(IAudioEndpointVolume), CLSCTX_ALL, nullptr, reinterpret_cast<void**>(volume.GetAddressOf()));
}

int setMute(bool muted) {
    ComPtr<IAudioEndpointVolume> volume;
    HRESULT hr = getDefaultEndpointVolume(volume);
    if (FAILED(hr)) return fail(L"Get default audio endpoint", hr);
    hr = volume->SetMute(muted ? TRUE : FALSE, nullptr);
    if (FAILED(hr)) return fail(L"SetMute", hr);
    return 0;
}

int getMute() {
    ComPtr<IAudioEndpointVolume> volume;
    HRESULT hr = getDefaultEndpointVolume(volume);
    if (FAILED(hr)) return fail(L"Get default audio endpoint", hr);
    BOOL muted = FALSE;
    hr = volume->GetMute(&muted);
    if (FAILED(hr)) return fail(L"GetMute", hr);
    std::wcout << (muted ? L"1" : L"0") << std::endl;
    return 0;
}

class ActivationHandler final : public RuntimeClass<RuntimeClassFlags<ClassicCom>, FtmBase, IActivateAudioInterfaceCompletionHandler> {
public:
    ActivationHandler() : completed_(CreateEventW(nullptr, FALSE, FALSE, nullptr)) {}
    ~ActivationHandler() {
        if (completed_) CloseHandle(completed_);
    }

    STDMETHOD(ActivateCompleted)(IActivateAudioInterfaceAsyncOperation* operation) override {
        ComPtr<IUnknown> audioInterface;
        HRESULT activationHr = E_FAIL;
        HRESULT hr = operation->GetActivateResult(&activationHr, &audioInterface);
        if (SUCCEEDED(hr)) hr = activationHr;
        if (SUCCEEDED(hr)) hr = audioInterface.As(&client_);
        result_ = hr;
        SetEvent(completed_);
        return S_OK;
    }

    HRESULT wait(IAudioClient** client) {
        if (!completed_) return HRESULT_FROM_WIN32(GetLastError());
        DWORD waitResult = WaitForSingleObject(completed_, 10000);
        if (waitResult != WAIT_OBJECT_0) {
            return waitResult == WAIT_TIMEOUT ? HRESULT_FROM_WIN32(ERROR_TIMEOUT) : HRESULT_FROM_WIN32(GetLastError());
        }
        if (FAILED(result_)) return result_;
        return client_.CopyTo(client);
    }

private:
    HANDLE completed_ = nullptr;
    HRESULT result_ = E_PENDING;
    ComPtr<IAudioClient> client_;
};

HRESULT activateProcessLoopback(ComPtr<IAudioClient>& client) {
    AUDIOCLIENT_ACTIVATION_PARAMS params{};
    params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
    params.ProcessLoopbackParams.TargetProcessId = GetCurrentProcessId();
    params.ProcessLoopbackParams.ProcessLoopbackMode = PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;

    PROPVARIANT activateParams{};
    PropVariantInit(&activateParams);
    activateParams.vt = VT_BLOB;
    activateParams.blob.cbSize = sizeof(params);
    activateParams.blob.pBlobData = reinterpret_cast<BYTE*>(&params);

    auto handler = Make<ActivationHandler>();
    if (!handler) return E_OUTOFMEMORY;

    ComPtr<IActivateAudioInterfaceAsyncOperation> operation;
    HRESULT hr = ActivateAudioInterfaceAsync(
        VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
        __uuidof(IAudioClient),
        &activateParams,
        handler.Get(),
        &operation);
    if (FAILED(hr)) return hr;

    return handler->wait(client.GetAddressOf());
}

int capturePcm() {
    if (_setmode(_fileno(stdout), _O_BINARY) == -1) {
        std::wcerr << L"MRD Audio Router: failed to set stdout to binary mode." << std::endl;
        return 1;
    }

    ComPtr<IAudioClient> audioClient;
    HRESULT hr = activateProcessLoopback(audioClient);
    if (FAILED(hr)) return fail(L"Activate process loopback", hr);

    WAVEFORMATEX format{};
    format.wFormatTag = WAVE_FORMAT_PCM;
    format.nChannels = kChannels;
    format.nSamplesPerSec = kSampleRate;
    format.wBitsPerSample = kBitsPerSample;
    format.nBlockAlign = format.nChannels * format.wBitsPerSample / 8;
    format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;
    format.cbSize = 0;

    DWORD flags = AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
    hr = audioClient->Initialize(AUDCLNT_SHAREMODE_SHARED, flags, 0, 0, &format, nullptr);
    if (FAILED(hr)) return fail(L"IAudioClient::Initialize", hr);

    ComPtr<IAudioCaptureClient> captureClient;
    hr = audioClient->GetService(IID_PPV_ARGS(&captureClient));
    if (FAILED(hr)) return fail(L"Get IAudioCaptureClient", hr);

    hr = audioClient->Start();
    if (FAILED(hr)) return fail(L"IAudioClient::Start", hr);

    SetConsoleCtrlHandler(consoleHandler, TRUE);
    HANDLE out = GetStdHandle(STD_OUTPUT_HANDLE);
    std::vector<BYTE> silence;

    while (!g_stop.load()) {
        UINT32 packetFrames = 0;
        hr = captureClient->GetNextPacketSize(&packetFrames);
        if (FAILED(hr)) break;

        if (packetFrames == 0) {
            Sleep(kPollMs);
            continue;
        }

        while (packetFrames > 0 && !g_stop.load()) {
            BYTE* data = nullptr;
            UINT32 frames = 0;
            DWORD captureFlags = 0;
            UINT64 devicePosition = 0;
            UINT64 qpcPosition = 0;
            hr = captureClient->GetBuffer(&data, &frames, &captureFlags, &devicePosition, &qpcPosition);
            if (FAILED(hr)) break;

            DWORD bytes = frames * format.nBlockAlign;
            const BYTE* writeData = data;
            if ((captureFlags & AUDCLNT_BUFFERFLAGS_SILENT) || data == nullptr) {
                silence.assign(bytes, 0);
                writeData = silence.data();
            }

            DWORD written = 0;
            BOOL ok = WriteFile(out, writeData, bytes, &written, nullptr);
            captureClient->ReleaseBuffer(frames);
            if (!ok || written != bytes) {
                g_stop.store(true);
                break;
            }

            hr = captureClient->GetNextPacketSize(&packetFrames);
            if (FAILED(hr)) break;
        }

        if (FAILED(hr)) break;
    }

    audioClient->Stop();
    if (FAILED(hr)) return fail(L"Capture", hr);
    return 0;
}

void usage() {
    std::wcerr << L"Usage:\n"
               << L"  mrd-audio-router.exe get-mute\n"
               << L"  mrd-audio-router.exe mute <0|1>\n"
               << L"  mrd-audio-router.exe capture\n";
}
} // namespace

int wmain(int argc, wchar_t* argv[]) {
    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(hr) && hr != RPC_E_CHANGED_MODE) return fail(L"CoInitializeEx", hr);

    int result = 1;
    if (argc == 2 && _wcsicmp(argv[1], L"get-mute") == 0) {
        result = getMute();
    } else if (argc == 3 && _wcsicmp(argv[1], L"mute") == 0) {
        if (wcscmp(argv[2], L"0") == 0) result = setMute(false);
        else if (wcscmp(argv[2], L"1") == 0) result = setMute(true);
        else usage();
    } else if (argc == 2 && _wcsicmp(argv[1], L"capture") == 0) {
        result = capturePcm();
    } else {
        usage();
    }

    if (SUCCEEDED(hr)) CoUninitialize();
    return result;
}
