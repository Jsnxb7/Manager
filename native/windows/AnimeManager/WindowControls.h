#pragma once
#include "pch.h"
#include "NativeModules.h"
#include <shellapi.h>
#include <stdexcept>
#include <string>
#include <functional>
#include <vector>
#include <commctrl.h>
#include <oleidl.h>
#include <cwchar>
#include <algorithm>
#include <shlobj.h>
inline HWND g_mainWindow = nullptr;
inline winrt::Microsoft::ReactNative::ReactNativeHost g_reactHost{nullptr};
inline winrt::Microsoft::UI::Windowing::AppWindow g_appWindow{nullptr};
// Set by CatalogPlayer: closes the video window, so a UI reload leaves nothing behind.
inline std::function<void()> g_closePlayer;
inline void const *g_closePlayerOwner = nullptr;
inline void ReloadUi() {
  if (g_closePlayer) g_closePlayer();
  g_reactHost.ReloadInstance();
}
// Windows' own full-screen mode: covers the taskbar and hides the title bar. Restyling
// the window by hand does not stick on an AppWindow, which reapplies its presenter.
inline bool SetAppFullscreen(bool on) {
  if (!g_appWindow) return false;
  using winrt::Microsoft::UI::Windowing::AppWindowPresenterKind;
  g_appWindow.SetPresenter(on ? AppWindowPresenterKind::FullScreen : AppWindowPresenterKind::Default);
  return true;
}
inline bool IsAppFullscreen() {
  using winrt::Microsoft::UI::Windowing::AppWindowPresenterKind;
  return g_appWindow && g_appWindow.Presenter().Kind() == AppWindowPresenterKind::FullScreen;
}
// Sends dropped file paths to the page (see src/platform/drops.ts).
inline std::function<void(std::vector<std::string> const &)> g_emitDrop;

inline std::vector<std::string> DroppedPaths(HDROP drop) {
  std::vector<std::string> paths;
  UINT const count = DragQueryFileW(drop, 0xFFFFFFFF, nullptr, 0);
  for (UINT i = 0; i < count; ++i) {
    std::wstring path(DragQueryFileW(drop, i, nullptr, 0) + 1, L'\0');
    path.resize(DragQueryFileW(drop, i, path.data(), static_cast<UINT>(path.size())));
    paths.push_back(winrt::to_string(path));
  }
  return paths;
}

// Accepts files dragged from Explorer or other apps onto the window's content.
struct FileDropTarget : winrt::implements<FileDropTarget, IDropTarget> {
  bool files = false;
  static bool HasFiles(IDataObject *data) {
    FORMATETC format{CF_HDROP, nullptr, DVASPECT_CONTENT, -1, TYMED_HGLOBAL};
    return data && SUCCEEDED(data->QueryGetData(&format));
  }
  HRESULT __stdcall DragEnter(IDataObject *data, DWORD, POINTL, DWORD *effect) noexcept override {
    files = HasFiles(data);
    *effect = files ? DROPEFFECT_COPY : DROPEFFECT_NONE;
    return S_OK;
  }
  HRESULT __stdcall DragOver(DWORD, POINTL, DWORD *effect) noexcept override {
    *effect = files ? DROPEFFECT_COPY : DROPEFFECT_NONE;
    return S_OK;
  }
  HRESULT __stdcall DragLeave() noexcept override { files = false; return S_OK; }
  HRESULT __stdcall Drop(IDataObject *data, DWORD, POINTL, DWORD *effect) noexcept override {
    *effect = DROPEFFECT_NONE;
    FORMATETC format{CF_HDROP, nullptr, DVASPECT_CONTENT, -1, TYMED_HGLOBAL};
    STGMEDIUM medium{};
    if (data && SUCCEEDED(data->GetData(&format, &medium))) {
      // DragQueryFile takes the HDROP handle itself, not a locked pointer to it.
      auto paths = DroppedPaths(static_cast<HDROP>(medium.hGlobal));
      if (!paths.empty() && g_emitDrop) { g_emitDrop(paths); *effect = DROPEFFECT_COPY; }
      ReleaseStgMedium(&medium);
    }
    files = false;
    return S_OK;
  }
};

REACT_MODULE(WindowControls)
struct WindowControls {
  winrt::Microsoft::ReactNative::ReactContext context;
  bool full=false;LONG style=0;RECT normal{};
  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &value) noexcept {
    context=value;
    Current()=this;
    // A plain string travels to the page the same way Esc does; "|" cannot occur in
    // a Windows file name, so it separates the paths.
    g_emitDrop = [this](std::vector<std::string> const &paths) {
      std::string joined;
      for (auto const &path : paths) joined += (joined.empty() ? "" : "|") + path;
      context.EmitJSEvent(L"RCTDeviceEventEmitter", L"filesDropped", joined);
    };
    context.UIDispatcher().Post([]() noexcept { InstallInput(); RegisterDropTargets(); });
  }
  // Drops over the page land on the content windows inside the main window, so each
  // gets the same target. Runs once the page exists (this module starts with it).
  static IDropTarget *DropTarget() {
    static auto target = winrt::make<FileDropTarget>();
    return target.as<IDropTarget>().get();
  }
  static void AddDropTarget(HWND hwnd) {
    if (!GetPropW(hwnd, L"OleDropTargetInterface")) RegisterDragDrop(hwnd, DropTarget());
  }
  static BOOL CALLBACK AddChildDropTarget(HWND child, LPARAM) {
    WCHAR name[64]{};
    GetClassNameW(child, name, 64);
    // Video windows keep their own input; drops go to the page around them.
    if (wcscmp(name, L"AnimeManagerVideo") && wcscmp(name, L"AnimeManagerPreview") && wcscmp(name, L"mpv")) AddDropTarget(child);
    return TRUE;
  }
  static void RegisterDropTargets() noexcept {
    if (!g_mainWindow) return;
    OleInitialize(nullptr);
    AddDropTarget(g_mainWindow);
    EnumChildWindows(g_mainWindow, AddChildDropTarget, 0);
  }
  // Called at start-up from the window's thread (AnimeManager.cpp): native modules
  // are created lazily, so waiting for Initialize would miss keys until Settings opens.
  static void InstallInput() noexcept {
    static HHOOK hook = nullptr;
    if (!hook) hook = SetWindowsHookExW(WH_KEYBOARD, KeyHook, nullptr, GetCurrentThreadId());
    // Files dragged onto the window go to the page that can use them.
    static bool drops = false;
    if (!drops && g_mainWindow) { DragAcceptFiles(g_mainWindow, TRUE); drops = SetWindowSubclass(g_mainWindow, DropProc, 1, 0) != FALSE; }
  }
  static LRESULT CALLBACK DropProc(HWND hwnd, UINT message, WPARAM wp, LPARAM lp, UINT_PTR, DWORD_PTR) {
    if (message == WM_DROPFILES) {
      auto drop = reinterpret_cast<HDROP>(wp);
      auto paths = DroppedPaths(drop);
      DragFinish(drop);
      if (!paths.empty() && g_emitDrop) g_emitDrop(paths);
      return 0;
    }
    return DefSubclassProc(hwnd, message, wp, lp);
  }
  ~WindowControls() { if (Current() == this) Current() = nullptr; }
  // Starts a downloaded update and closes the app so it can be replaced. Only an
  // installer in the app's own updates folder is accepted. Windows asks for
  // permission (UAC); declining leaves the app running.
  static void RunInstaller(std::wstring const &path) {
    PWSTR local = nullptr;
    if (FAILED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &local))) throw std::runtime_error("App data folder unavailable");
    std::wstring folder = std::wstring(local) + L"\\AnimeManager\\updates\\";
    CoTaskMemFree(local);
    std::wstring file = path;
    std::replace(file.begin(), file.end(), L'/', L'\\');
    auto const name = file.substr(file.find_last_of(L'\\') + 1);
    if (_wcsnicmp(file.c_str(), folder.c_str(), folder.size()) != 0 || file.find(L"..") != std::wstring::npos ||
        name.rfind(L"AnimeManager-Setup-", 0) != 0 || name.size() < 4 || _wcsicmp(name.c_str() + name.size() - 4, L".exe") != 0)
      throw std::runtime_error("Only an Anime Manager installer from the updates folder can run");
    SHELLEXECUTEINFOW info{sizeof(info)};
    info.fMask = SEE_MASK_NOASYNC;
    info.lpVerb = L"open";
    info.lpFile = file.c_str();
    info.lpParameters = L"/SILENT /SUPPRESSMSGBOXES /NORESTART /CLOSEAPPLICATIONS";
    info.nShow = SW_SHOWNORMAL;
    if (!ShellExecuteExW(&info)) throw std::runtime_error(GetLastError() == ERROR_CANCELLED ? "Update cancelled" : "Could not start the update");
    if (g_closePlayer) g_closePlayer();
    PostMessageW(g_mainWindow, WM_CLOSE, 0, 0);
  }
  static bool &CaptureArrows() { static bool value = false; return value; }
  static WindowControls *&Current() { static WindowControls *value = nullptr; return value; }
  // App shortcuts work wherever focus is in the window (the page or nothing at all).
  // Keys typed into the video go to mpv, which has the same bindings.
  static LRESULT CALLBACK KeyHook(int code, WPARAM key, LPARAM flags) {
    bool const down = code == HC_ACTION && !(flags & (1u << 31)) && !(flags & (1u << 30));
    if (down && g_mainWindow && GetForegroundWindow() == g_mainWindow) {
      bool const ctrl = GetKeyState(VK_CONTROL) < 0;
      try {
        if (key == VK_F11) { SetAppFullscreen(!IsAppFullscreen()); return 1; }
        if (ctrl && key == 'R') { ReloadUi(); return 1; }
        if (ctrl && key == 'M') { ShowWindow(g_mainWindow, SW_MINIMIZE); return 1; }
        if (ctrl && key == 'K' && Current()) { Current()->context.EmitJSEvent(L"RCTDeviceEventEmitter", L"appKey", std::string("Ctrl+K")); return 1; }
        if (key == VK_ESCAPE && Current()) Current()->context.EmitJSEvent(L"RCTDeviceEventEmitter", L"appKey", std::string("Escape"));
        // While a page asks for them (a focused list of suggestions), Up and Down move
        // through it instead of scrolling the page.
        if (CaptureArrows() && (key == VK_UP || key == VK_DOWN) && Current()) {
          Current()->context.EmitJSEvent(L"RCTDeviceEventEmitter", L"appKey", std::string(key == VK_UP ? "ArrowUp" : "ArrowDown"));
          return 1;
        }
      } catch (...) {}
    }
    return CallNextHookEx(nullptr, code, key, flags);
  }
  REACT_METHOD(Execute, L"execute")
  void Execute(std::string action,winrt::Microsoft::ReactNative::ReactPromise<void> promise) noexcept {
    context.UIDispatcher().Post([this,action,promise]() noexcept {
      try {
        if(!g_mainWindow)throw std::runtime_error("Main window is unavailable");
        if(action=="alwaysOnTop"){bool top=(GetWindowLongW(g_mainWindow,GWL_EXSTYLE)&WS_EX_TOPMOST)!=0;SetWindowPos(g_mainWindow,top?HWND_NOTOPMOST:HWND_TOPMOST,0,0,0,0,SWP_NOMOVE|SWP_NOSIZE);}
        else if(action=="fullscreen"&&g_appWindow){SetAppFullscreen(!IsAppFullscreen());}
        else if(action=="fullscreen"){if(!full){GetWindowRect(g_mainWindow,&normal);style=GetWindowLongW(g_mainWindow,GWL_STYLE);SetWindowLongW(g_mainWindow,GWL_STYLE,WS_POPUP|WS_VISIBLE);MONITORINFO info{sizeof(info)};GetMonitorInfoW(MonitorFromWindow(g_mainWindow,MONITOR_DEFAULTTONEAREST),&info);SetWindowPos(g_mainWindow,HWND_TOP,info.rcMonitor.left,info.rcMonitor.top,info.rcMonitor.right-info.rcMonitor.left,info.rcMonitor.bottom-info.rcMonitor.top,SWP_FRAMECHANGED);}else{SetWindowLongW(g_mainWindow,GWL_STYLE,style);SetWindowPos(g_mainWindow,nullptr,normal.left,normal.top,normal.right-normal.left,normal.bottom-normal.top,SWP_NOZORDER|SWP_FRAMECHANGED);}full=!full;}
        else if(action=="reload"){ReloadUi();}
        else if(action=="minimize"){ShowWindow(g_mainWindow,SW_MINIMIZE);}
        else if(action.rfind("runInstaller|",0)==0){RunInstaller(winrt::to_hstring(action.substr(13)).c_str());}
        else if(action=="arrowsOn"){CaptureArrows()=true;}
        else if(action=="arrowsOff"){CaptureArrows()=false;}
        else if(action=="restart"){WCHAR path[MAX_PATH];GetModuleFileNameW(nullptr,path,MAX_PATH);if(reinterpret_cast<INT_PTR>(ShellExecuteW(nullptr,L"open",path,nullptr,nullptr,SW_SHOWNORMAL))<=32)throw std::runtime_error("Could not restart app");PostMessageW(g_mainWindow,WM_CLOSE,0,0);}
        else throw std::runtime_error("Unknown window action");promise.Resolve();
      }catch(std::exception const &error){promise.Reject(error.what());}catch(winrt::hresult_error const &error){promise.Reject(error.message().c_str());}
    });
  }
};
