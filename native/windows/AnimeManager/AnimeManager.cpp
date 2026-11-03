// AnimeManager.cpp : Defines the entry point for the application.
//

#include "pch.h"
#include "AnimeManager.h"
#include "resource.h"

#include "AutolinkedNativeModules.g.h"

#include "NativeModules.h"
#include "CatalogStorage.h"
#include "CatalogPlayer.h"
#include "WindowControls.h"

// A PackageProvider containing any turbo modules you define within this app project
struct CompReactPackageProvider
    : winrt::implements<CompReactPackageProvider, winrt::Microsoft::ReactNative::IReactPackageProvider> {
 public: // IReactPackageProvider
  void CreatePackage(winrt::Microsoft::ReactNative::IReactPackageBuilder const &packageBuilder) noexcept {
    AddAttributedModules(packageBuilder, true);
  }
};

// The entry point of the Win32 application
_Use_decl_annotations_ int CALLBACK WinMain(HINSTANCE instance, HINSTANCE, PSTR /* commandLine */, int showCmd) {
  // Initialize WinRT
  winrt::init_apartment(winrt::apartment_type::single_threaded);

  // Enable per monitor DPI scaling
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

  // Find the path hosting the app exe file
  WCHAR appDirectory[MAX_PATH];
  GetModuleFileNameW(NULL, appDirectory, MAX_PATH);
  PathCchRemoveFileSpec(appDirectory, MAX_PATH);

  // Create a ReactNativeWin32App with the ReactNativeAppBuilder
  auto reactNativeWin32App{winrt::Microsoft::ReactNative::ReactNativeAppBuilder().Build()};

  // Configure the initial InstanceSettings for the app's ReactNativeHost
  auto settings{reactNativeWin32App.ReactNativeHost().InstanceSettings()};
  // Register any autolinked native modules
  RegisterAutolinkedNativeModulePackages(settings.PackageProviders());
  // Register any native modules defined within this app project
  settings.PackageProviders().Append(winrt::make<CompReactPackageProvider>());

    // When loading the JS bundle from a file (not Metro):
  // Set the path (on disk) where the .bundle file is located
  settings.BundleRootPath(std::wstring(L"file://").append(appDirectory).append(L"\\Bundle\\").c_str());

  // Set the name of the bundle file (without the .bundle extension)
  settings.JavaScriptBundleFile(L"index.windows");

  // JS Entry file to use when loading from Metro:
  settings.DebugBundlePath(L"index");

#if BUNDLE
  // Disable hot reload - bundle will be loaded from prebuilt bundle file.
  settings.UseFastRefresh(false);
#else
  // Enable hot reload - load the JS bundle from Metro
  settings.UseFastRefresh(true);
#endif
#if _DEBUG
  // For Debug builds
  // Enable Direct Debugging of JS
  settings.UseDirectDebugger(true);
  // Enable the Developer Menu
  settings.UseDeveloperSupport(true);
#else
  // For Release builds:
  // Disable Direct Debugging of JS
  settings.UseDirectDebugger(false);
  // Disable the Developer Menu
  settings.UseDeveloperSupport(false);
#endif

  // Get the AppWindow so we can configure its initial title and size
  auto appWindow{reactNativeWin32App.AppWindow()};
  g_mainWindow = winrt::Microsoft::UI::GetWindowFromWindowId(appWindow.Id());
  g_appWindow = appWindow;
  g_reactHost = reactNativeWin32App.ReactNativeHost();
  appWindow.Title(L"Anime Manager");
  // Taskbar and title bar take the icon from the exe's own resource, not Windows'
  // icon cache, which can keep showing an older icon after an update.
  {
    HINSTANCE const module = GetModuleHandleW(nullptr);
    auto load = [&](int size) {
      return static_cast<HICON>(LoadImageW(module, MAKEINTRESOURCEW(IDI_ICON1), IMAGE_ICON, size, size, 0));
    };
    UINT const dpi = GetDpiForWindow(g_mainWindow);
    HICON const bigIcon = load(GetSystemMetricsForDpi(SM_CXICON, dpi));
    HICON const smallIcon = load(GetSystemMetricsForDpi(SM_CXSMICON, dpi));
    if (bigIcon) {
      appWindow.SetIcon(winrt::Microsoft::UI::GetIconIdFromIcon(bigIcon));
      SendMessageW(g_mainWindow, WM_SETICON, ICON_BIG, reinterpret_cast<LPARAM>(bigIcon));
    }
    if (smallIcon) SendMessageW(g_mainWindow, WM_SETICON, ICON_SMALL, reinterpret_cast<LPARAM>(smallIcon));
  }
  appWindow.Resize({1440, 900});
  // Pages draw up to the top of the window; only the caption buttons stay on top.
  {
    winrt::Windows::UI::Color const panel{0, 0, 0, 0};
    winrt::Windows::UI::Color const raised{255, 29, 43, 58};
    winrt::Windows::UI::Color const text{255, 242, 246, 250};
    winrt::Windows::UI::Color const muted{255, 156, 175, 192};
    auto titleBar{appWindow.TitleBar()};
    titleBar.ExtendsContentIntoTitleBar(true);
    titleBar.BackgroundColor(panel);
    titleBar.ForegroundColor(text);
    titleBar.InactiveBackgroundColor(panel);
    titleBar.InactiveForegroundColor(muted);
    titleBar.ButtonBackgroundColor(panel);
    titleBar.ButtonForegroundColor(text);
    titleBar.ButtonHoverBackgroundColor(raised);
    titleBar.ButtonHoverForegroundColor(text);
    titleBar.ButtonPressedBackgroundColor(raised);
    titleBar.ButtonPressedForegroundColor(text);
    titleBar.ButtonInactiveBackgroundColor(panel);
    titleBar.ButtonInactiveForegroundColor(muted);
  }

  // Get the ReactViewOptions so we can set the initial RN component to load
  auto viewOptions{reactNativeWin32App.ReactViewOptions()};
  viewOptions.ComponentName(L"AnimeManager");

  // Start the app
  reactNativeWin32App.Start();
}
