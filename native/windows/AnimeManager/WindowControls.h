#pragma once
#include "pch.h"
#include "NativeModules.h"
inline HWND g_mainWindow = nullptr;
inline winrt::Microsoft::ReactNative::ReactNativeHost g_reactHost{nullptr};
REACT_MODULE(WindowControls)
struct WindowControls {
  winrt::Microsoft::ReactNative::ReactContext context;
  bool full=false;LONG style=0;RECT normal{};
  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &value) noexcept {context=value;}
  REACT_METHOD(execute)
  void Execute(std::string action,winrt::Microsoft::ReactNative::ReactPromise<void> promise) noexcept {
    context.UIDispatcher().Post([this,action,promise]() noexcept {
      try {
        if(!g_mainWindow)throw std::runtime_error("Main window is unavailable");
        if(action=="alwaysOnTop"){bool top=(GetWindowLongW(g_mainWindow,GWL_EXSTYLE)&WS_EX_TOPMOST)!=0;SetWindowPos(g_mainWindow,top?HWND_NOTOPMOST:HWND_TOPMOST,0,0,0,0,SWP_NOMOVE|SWP_NOSIZE);}
        else if(action=="fullscreen"){if(!full){GetWindowRect(g_mainWindow,&normal);style=GetWindowLongW(g_mainWindow,GWL_STYLE);SetWindowLongW(g_mainWindow,GWL_STYLE,WS_POPUP|WS_VISIBLE);MONITORINFO info{sizeof(info)};GetMonitorInfoW(MonitorFromWindow(g_mainWindow,MONITOR_DEFAULTTONEAREST),&info);SetWindowPos(g_mainWindow,HWND_TOP,info.rcMonitor.left,info.rcMonitor.top,info.rcMonitor.right-info.rcMonitor.left,info.rcMonitor.bottom-info.rcMonitor.top,SWP_FRAMECHANGED);}else{SetWindowLongW(g_mainWindow,GWL_STYLE,style);SetWindowPos(g_mainWindow,nullptr,normal.left,normal.top,normal.right-normal.left,normal.bottom-normal.top,SWP_NOZORDER|SWP_FRAMECHANGED);}full=!full;}
        else if(action=="reload"){g_reactHost.ReloadInstance();}
        else if(action=="restart"){WCHAR path[MAX_PATH];GetModuleFileNameW(nullptr,path,MAX_PATH);if(reinterpret_cast<INT_PTR>(ShellExecuteW(nullptr,L"open",path,nullptr,nullptr,SW_SHOWNORMAL))<=32)throw std::runtime_error("Could not restart app");PostMessageW(g_mainWindow,WM_CLOSE,0,0);}
        else throw std::runtime_error("Unknown window action");promise.Resolve();
      }catch(std::exception const &error){promise.Reject(error.what());}catch(winrt::hresult_error const &error){promise.Reject(winrt::to_string(error.message()));}
    });
  }
};
