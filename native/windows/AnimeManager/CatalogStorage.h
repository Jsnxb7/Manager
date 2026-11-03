#pragma once
#include "pch.h"
#include "NativeModules.h"
#include <filesystem>
#include <algorithm>
#include <cwctype>
#include <vector>
#include <stdexcept>
#include <fstream>
#include <iterator>
#include <set>
#include <sstream>
#include <string>
#include <shellapi.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <wincodec.h>
#include "src/webp/encode.h"
#include <winrt/Windows.Data.Json.h>
#include <winrt/Windows.Security.Cryptography.h>
#include <winrt/Windows.Security.Cryptography.Core.h>
#include <regex>
#include <winrt/Windows.Storage.Streams.h>

namespace fs = std::filesystem;
namespace Json = winrt::Windows::Data::Json;
namespace Crypto = winrt::Windows::Security::Cryptography;

REACT_MODULE(CatalogStorage)
struct CatalogStorage {
  winrt::Microsoft::ReactNative::ReactContext context;
  fs::path root;
  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &value) noexcept {
    context = value;
    PWSTR local = nullptr;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &local))) {
      root = fs::path(local) / L"AnimeManager" / L"catalogs";
      CoTaskMemFree(local);
      std::error_code error; fs::create_directories(root, error);
    }
  }
  static std::string Read(fs::path const &path) {
    if (fs::file_size(path) > 768ull * 1024 * 1024) throw std::runtime_error("File exceeds transfer limit");
    std::ifstream stream(path, std::ios::binary);
    if (!stream) throw std::runtime_error("Cannot read file");
    return {std::istreambuf_iterator<char>(stream), std::istreambuf_iterator<char>()};
  }
  static void Write(fs::path const &path, std::string const &text) {
    fs::create_directories(path.parent_path());
    std::ofstream stream(path, std::ios::binary | std::ios::trunc);
    stream.write(text.data(), static_cast<std::streamsize>(text.size())); stream.flush();
    if (!stream) throw std::runtime_error("Cannot save file; check free space and permissions");
  }
  // Decodes through WIC, shrinks to maxWidth at most and saves as WebP. Throws
  // on undecodable input so callers can keep the original bytes.
  static void EncodeWebp(fs::path const &source, fs::path const &destination, UINT maxWidth) {
    auto const com = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(com) && com != RPC_E_CHANGED_MODE) winrt::throw_hresult(com);
    struct ComScope { bool owned; ~ComScope() { if (owned) CoUninitialize(); } } scope{SUCCEEDED(com)};
    winrt::com_ptr<IWICImagingFactory> factory;
    winrt::check_hresult(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(factory.put())));
    winrt::com_ptr<IWICBitmapDecoder> decoder;
    winrt::check_hresult(factory->CreateDecoderFromFilename(source.c_str(), nullptr, GENERIC_READ, WICDecodeMetadataCacheOnDemand, decoder.put()));
    winrt::com_ptr<IWICBitmapFrameDecode> frame;
    winrt::check_hresult(decoder->GetFrame(0, frame.put()));
    UINT width = 0, height = 0;
    winrt::check_hresult(frame->GetSize(&width, &height));
    if (!width || !height) throw std::runtime_error("Image has no pixels");
    UINT const outWidth = maxWidth && width > maxWidth ? maxWidth : width;
    UINT const outHeight = (std::max)(1u, static_cast<UINT>(static_cast<UINT64>(height) * outWidth / width));
    winrt::com_ptr<IWICBitmapScaler> scaler;
    winrt::check_hresult(factory->CreateBitmapScaler(scaler.put()));
    winrt::check_hresult(scaler->Initialize(frame.get(), outWidth, outHeight, WICBitmapInterpolationModeHighQualityCubic));
    winrt::com_ptr<IWICFormatConverter> converter;
    winrt::check_hresult(factory->CreateFormatConverter(converter.put()));
    winrt::check_hresult(converter->Initialize(scaler.get(), GUID_WICPixelFormat32bppBGRA, WICBitmapDitherTypeNone, nullptr, 0.0, WICBitmapPaletteTypeCustom));
    UINT const stride = outWidth * 4;
    std::vector<BYTE> pixels(static_cast<size_t>(stride) * outHeight);
    winrt::check_hresult(converter->CopyPixels(nullptr, stride, static_cast<UINT>(pixels.size()), pixels.data()));
    uint8_t *encoded = nullptr;
    size_t const size = WebPEncodeBGRA(pixels.data(), static_cast<int>(outWidth), static_cast<int>(outHeight), static_cast<int>(stride), 82.0f, &encoded);
    if (!size || !encoded) throw std::runtime_error("WebP encoding failed");
    std::string const bytes(reinterpret_cast<char const *>(encoded), size);
    WebPFree(encoded);
    Write(destination, bytes);
  }
  static fs::path Path(winrt::hstring const &value) {
    std::wstring text(value); if (text.rfind(L"file://", 0) == 0) text = text.substr(7);
    return fs::path(text);
  }
  static bool Within(fs::path const &parent, fs::path const &child) {
    auto p = fs::weakly_canonical(parent); auto c = fs::weakly_canonical(child);
    auto pi = p.begin(), ci = c.begin();
    for (; pi != p.end(); ++pi, ++ci) {
      if (ci == c.end() || _wcsicmp(pi->c_str(), ci->c_str()) != 0) return false;
    }
    return ci != c.end();
  }
  fs::path Owned(winrt::hstring const &value) {
    auto path = Path(value);
    if (root.empty() || !Within(root, path)) throw std::runtime_error("Operation outside app private storage");
    return path;
  }
  static fs::path Child(fs::path const &parent, winrt::hstring const &relative) {
    std::wstring text(relative); std::replace(text.begin(), text.end(), L'\\', L'/');
    fs::path rel(text);
    if (rel.empty() || rel.is_absolute() || rel.has_root_name() || rel.has_root_directory()) throw std::runtime_error("Invalid relative media reference");
    for (auto const &part : rel) if (part == L".." || part == L"." || part.wstring().find(L':') != std::wstring::npos) throw std::runtime_error("Invalid relative media reference");
    auto target = parent / rel;
    if (!Within(parent, target)) throw std::runtime_error("Media reference escapes selected root");
    return target;
  }
  static Json::IJsonValue String(std::wstring const &text) { return Json::JsonValue::CreateStringValue(text); }
  fs::path MediaTarget(fs::path const &parent, winrt::hstring const &relative) {
    if (!Roots().count(parent.wstring())) throw std::runtime_error("Select the local media root first");
    auto target = Child(parent, relative);
    // Inspect lexical ancestors, before canonicalisation can hide a junction.
    auto walk = target.root_path();
    for (auto const &part : target.relative_path()) {
      auto name = part.wstring();
      auto base = name.substr(0, name.find(L'.'));
      std::transform(base.begin(), base.end(), base.begin(), ::towlower);
      if (base == L"con" || base == L"prn" || base == L"aux" || base == L"nul" || (base.size() == 4 && (base.substr(0, 3) == L"com" || base.substr(0, 3) == L"lpt") && base[3] >= L'1' && base[3] <= L'9')) throw std::runtime_error("Reserved media folder name");
      if (name.empty() || name.back() == L'.' || name.back() == L' ' || name.find_first_of(L"<>\"|?*") != std::wstring::npos || std::any_of(name.begin(), name.end(), [](wchar_t c) { return c < 32; })) throw std::runtime_error("Invalid media folder name");
      walk /= part;
      auto attributes = GetFileAttributesW(walk.c_str());
      if (attributes == INVALID_FILE_ATTRIBUTES) {
        auto error = GetLastError();
        if (error != ERROR_FILE_NOT_FOUND && error != ERROR_PATH_NOT_FOUND) throw std::runtime_error("Cannot inspect media folder");
      } else if ((attributes & FILE_ATTRIBUTE_REPARSE_POINT) || !(attributes & FILE_ATTRIBUTE_DIRECTORY)) throw std::runtime_error("Media path must contain only ordinary folders");
    }
    return target;
  }
  static Json::IJsonValue Null() { return Json::JsonValue::CreateNullValue(); }
  std::set<std::wstring> Roots() {
    std::set<std::wstring> result;
    auto file = root / L"approved-roots.json";
    if (fs::exists(file)) {
      auto values = Json::JsonArray::Parse(winrt::to_hstring(Read(file)));
      for (auto const &value : values) result.insert(std::wstring(value.GetString()));
    }
    return result;
  }
  void Approve(std::wstring const &path) {
    auto values = Roots(); values.insert(path); Json::JsonArray array;
    for (auto const &value : values) array.Append(String(value));
    Write(root / L"approved-roots.json", winrt::to_string(array.Stringify()));
  }
  static uint32_t Crc32(std::string const &data) {
    static auto const table = [] {
      std::vector<uint32_t> values(256);
      for (uint32_t i = 0; i < 256; ++i) { uint32_t c = i; for (int k = 0; k < 8; ++k) c = (c & 1) ? 0xEDB88320u ^ (c >> 1) : c >> 1; values[i] = c; }
      return values;
    }();
    uint32_t crc = 0xFFFFFFFFu;
    for (unsigned char byte : data) crc = table[(crc ^ byte) & 0xFF] ^ (crc >> 8);
    return crc ^ 0xFFFFFFFFu;
  }
  static winrt::hstring Sha256(std::string const &data) {
    auto const *begin = reinterpret_cast<uint8_t const *>(data.data());
    auto buffer = Crypto::CryptographicBuffer::CreateFromByteArray(winrt::array_view<uint8_t const>(begin, begin + data.size()));
    auto digest = Crypto::Core::HashAlgorithmProvider::OpenAlgorithm(Crypto::Core::HashAlgorithmNames::Sha256()).HashData(buffer);
    return Crypto::CryptographicBuffer::EncodeToHexString(digest);
  }
  // A plain ZIP with every file stored as-is: covers are already compressed, and
  // stored entries open in any unzip tool and in the app's own importer.
  struct ZipWriter {
    struct Entry { std::string name; uint32_t crc, size, offset; };
    std::ofstream out; std::vector<Entry> entries; uint64_t at = 0;
    explicit ZipWriter(fs::path const &path) : out(path, std::ios::binary | std::ios::trunc) { if (!out) throw std::runtime_error("Cannot create the export file"); }
    void Put(uint64_t value, int size) { for (int i = 0; i < size; ++i) { char c = static_cast<char>((value >> (8 * i)) & 0xFF); out.write(&c, 1); } at += size; }
    void Raw(std::string const &text) { out.write(text.data(), static_cast<std::streamsize>(text.size())); at += text.size(); }
    void Add(std::string const &name, std::string const &data) {
      if (at + data.size() > 0xF0000000ull) throw std::runtime_error("Export is too large for a ZIP file");
      Entry entry{name, Crc32(data), static_cast<uint32_t>(data.size()), static_cast<uint32_t>(at)};
      Put(0x04034b50, 4); Put(20, 2); Put(0x0800, 2); Put(0, 2); Put(0, 2); Put(0x21, 2);
      Put(entry.crc, 4); Put(entry.size, 4); Put(entry.size, 4); Put(name.size(), 2); Put(0, 2);
      Raw(name); Raw(data); entries.push_back(std::move(entry));
    }
    void Finish() {
      uint64_t const start = at;
      for (auto const &entry : entries) {
        Put(0x02014b50, 4); Put(20, 2); Put(20, 2); Put(0x0800, 2); Put(0, 2); Put(0, 2); Put(0x21, 2);
        Put(entry.crc, 4); Put(entry.size, 4); Put(entry.size, 4); Put(entry.name.size(), 2);
        Put(0, 2); Put(0, 2); Put(0, 2); Put(0, 2); Put(0, 4); Put(entry.offset, 4); Raw(entry.name);
      }
      uint64_t const size = at - start;
      Put(0x06054b50, 4); Put(0, 2); Put(0, 2); Put(entries.size(), 2); Put(entries.size(), 2); Put(size, 4); Put(start, 4); Put(0, 2);
      out.flush();
      if (!out) throw std::runtime_error("Could not finish the export file; check free space");
      out.close();
    }
  };
  // Writes the catalog, its covers and a checksummed manifest straight from disk.
  // Opens a catalog ZIP written with stored entries (the app's own exports), checking
  // names and sizes, extracting covers into app storage and reporting checksums.
  // Compressed packages from older exports report "compressed" so JavaScript opens them.
  Json::IJsonValue UnpackPackage(Json::JsonObject const &args) {
    static std::regex const artworkName(R"(^artwork/[A-Za-z0-9_-]+\.(webp|png|jpe?g|gif|avif)$)", std::regex::icase);
    fs::path const source = Path(args.GetNamedString(L"uri"));
    fs::path const staging = Owned(args.GetNamedString(L"staging"));
    std::ifstream in(source, std::ios::binary);
    if (!in) throw std::runtime_error("Cannot open the catalog package");
    in.seekg(0, std::ios::end);
    uint64_t const length = static_cast<uint64_t>(in.tellg());
    auto readAt = [&](uint64_t at, size_t size) {
      if (at + size > length) throw std::runtime_error("Catalog package is damaged");
      std::string buffer(size, '\0'); in.seekg(static_cast<std::streamoff>(at)); in.read(buffer.data(), static_cast<std::streamsize>(size));
      if (!in) throw std::runtime_error("Catalog package is damaged");
      return buffer;
    };
    auto u16 = [](std::string const &b, size_t i) { return static_cast<uint32_t>(static_cast<unsigned char>(b[i]) | (static_cast<unsigned char>(b[i + 1]) << 8)); };
    auto u32 = [&](std::string const &b, size_t i) { return u16(b, i) | (u16(b, i + 2) << 16); };
    // The end-of-directory record sits in the last 64 KiB.
    size_t const tail = static_cast<size_t>(std::min<uint64_t>(length, 65557));
    auto const end = readAt(length - tail, tail);
    size_t eocd = std::string::npos;
    for (size_t i = tail >= 22 ? tail - 22 : 0; i != std::string::npos; --i) { if (u32(end, i) == 0x06054b50) { eocd = i; break; } if (i == 0) break; }
    if (eocd == std::string::npos) throw std::runtime_error("Not a catalog package");
    uint32_t const count = u16(end, eocd + 10), directorySize = u32(end, eocd + 12), directoryAt = u32(end, eocd + 16);
    if (count > 10000) throw std::runtime_error("Package contains disallowed files or exceeds extraction limits.");
    auto const directory = readAt(directoryAt, directorySize);
    std::error_code ignored; fs::remove_all(staging, ignored); fs::create_directories(staging);
    Json::JsonObject result; Json::JsonArray files; uint64_t total = 0; size_t at = 0;
    for (uint32_t index = 0; index < count; ++index) {
      if (at + 46 > directory.size() || u32(directory, at) != 0x02014b50) throw std::runtime_error("Catalog package is damaged");
      uint32_t const method = u16(directory, at + 10), size = u32(directory, at + 20), stored = u32(directory, at + 24);
      uint32_t const nameLength = u16(directory, at + 28), extra = u16(directory, at + 30), comment = u16(directory, at + 32), offset = u32(directory, at + 42);
      std::string const name = directory.substr(at + 46, nameLength);
      at += 46 + nameLength + extra + comment;
      if (!name.empty() && name.back() == '/') continue;
      if (name != "manifest.json" && name != "data/catalog.json" && !std::regex_match(name, artworkName)) throw std::runtime_error("Package contains disallowed files or exceeds extraction limits.");
      if (method != 0 || size != stored) throw std::runtime_error("compressed package");
      total += size;
      if (size > 64u * 1024 * 1024 || total > 2048ull * 1024 * 1024) throw std::runtime_error("Package contains disallowed files or exceeds extraction limits.");
      auto const header = readAt(offset, 30);
      if (u32(header, 0) != 0x04034b50) throw std::runtime_error("Catalog package is damaged");
      auto const data = readAt(offset + 30 + u16(header, 26) + u16(header, 28), size);
      if (name == "manifest.json") { result.SetNamedValue(L"manifest", String(winrt::to_hstring(data).c_str())); continue; }
      if (name == "data/catalog.json") result.SetNamedValue(L"catalog", String(winrt::to_hstring(data).c_str()));
      else { auto const target = staging / fs::path(winrt::to_hstring(name).c_str()); Write(target, data); }
      Json::JsonObject file;
      file.SetNamedValue(L"name", String(winrt::to_hstring(name).c_str()));
      file.SetNamedValue(L"bytes", Json::JsonValue::CreateNumberValue(static_cast<double>(size)));
      file.SetNamedValue(L"sha256", Json::JsonValue::CreateStringValue(Sha256(data)));
      files.Append(file);
    }
    if (!result.HasKey(L"manifest") || !result.HasKey(L"catalog")) throw std::runtime_error("Missing package manifest or catalog");
    result.SetNamedValue(L"files", files);
    return result;
  }
  Json::IJsonValue WritePackage(Json::JsonObject const &args) {
    static std::regex const artworkName(R"(^artwork/[A-Za-z0-9_-]+\.(webp|png|jpe?g|gif|avif)$)", std::regex::icase);
    fs::path const target = Path(args.GetNamedString(L"target"));
    fs::path const partial = fs::path(target.wstring() + L".partial");
    auto manifest = Json::JsonObject::Parse(args.GetNamedObject(L"header").Stringify());
    Json::JsonObject files;
    auto describe = [&](std::string const &name, std::string const &data) {
      Json::JsonObject file;
      file.SetNamedValue(L"bytes", Json::JsonValue::CreateNumberValue(static_cast<double>(data.size())));
      file.SetNamedValue(L"sha256", Json::JsonValue::CreateStringValue(Sha256(data)));
      files.SetNamedValue(winrt::to_hstring(name), file);
    };
    {
      ZipWriter zip(partial);
      auto const catalog = winrt::to_string(args.GetNamedString(L"catalog"));
      zip.Add("data/catalog.json", catalog); describe("data/catalog.json", catalog);
      for (auto const &value : args.GetNamedArray(L"artwork")) {
        auto const item = value.GetObject();
        auto const name = winrt::to_string(item.GetNamedString(L"name"));
        if (!std::regex_match(name, artworkName)) throw std::runtime_error("Invalid artwork reference; videos cannot be exported.");
        auto const data = Read(Owned(item.GetNamedString(L"path")));
        zip.Add(name, data); describe(name, data);
      }
      manifest.SetNamedValue(L"files", files);
      zip.Add("manifest.json", winrt::to_string(manifest.Stringify()));
      zip.Finish();
    }
    if (!MoveFileExW(partial.c_str(), target.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) throw std::runtime_error("Could not save the export file");
    return String(target.wstring());
  }
  Json::IJsonValue Pick(std::string const &method, Json::JsonObject const &args) {
    if (method == "pickSaveTarget") {
      winrt::com_ptr<IFileSaveDialog> dialog;
      winrt::check_hresult(CoCreateInstance(CLSID_FileSaveDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(dialog.put())));
      dialog->SetFileName(args.GetNamedString(L"name").c_str());
      if (dialog->Show(nullptr) != S_OK) return Null();
      winrt::com_ptr<IShellItem> item; winrt::check_hresult(dialog->GetResult(item.put()));
      PWSTR selected = nullptr; winrt::check_hresult(item->GetDisplayName(SIGDN_FILESYSPATH, &selected));
      std::wstring filename(selected); CoTaskMemFree(selected);
      return String(filename);
    }
    if (method == "saveFile") {
      winrt::com_ptr<IFileSaveDialog> dialog;
      winrt::check_hresult(CoCreateInstance(CLSID_FileSaveDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(dialog.put())));
      dialog->SetFileName(args.GetNamedString(L"name").c_str());
      if (dialog->Show(nullptr) != S_OK) return Null();
      winrt::com_ptr<IShellItem> item; winrt::check_hresult(dialog->GetResult(item.put()));
      PWSTR selected = nullptr; winrt::check_hresult(item->GetDisplayName(SIGDN_FILESYSPATH, &selected));
      std::wstring filename(selected); CoTaskMemFree(selected);
      auto buffer = Crypto::CryptographicBuffer::DecodeFromBase64String(args.GetNamedString(L"value"));
      winrt::com_array<uint8_t> bytes; Crypto::CryptographicBuffer::CopyToByteArray(buffer, bytes);
      Write(filename, std::string(reinterpret_cast<char const *>(bytes.data()), bytes.size()));
      return String(filename);
    }
    winrt::com_ptr<IFileOpenDialog> dialog;
    winrt::check_hresult(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(dialog.put())));
    DWORD options = 0; dialog->GetOptions(&options);
    dialog->SetOptions(options | FOS_FORCEFILESYSTEM | (method == "pickFolder" ? FOS_PICKFOLDERS : FOS_ALLOWMULTISELECT));
    if (dialog->Show(nullptr) != S_OK) return method == "pickFolder" ? Null() : Json::JsonArray();
    winrt::com_ptr<IShellItemArray> items; winrt::check_hresult(dialog->GetResults(items.put()));
    DWORD count = 0; items->GetCount(&count); Json::JsonArray paths;
    for (DWORD i = 0; i < count; ++i) {
      winrt::com_ptr<IShellItem> item; items->GetItemAt(i, item.put());
      PWSTR selected = nullptr; winrt::check_hresult(item->GetDisplayName(SIGDN_FILESYSPATH, &selected));
      std::wstring filename(selected); CoTaskMemFree(selected);
      if (method == "pickFolder") { Approve(filename); return String(filename); }
      paths.Append(String(filename));
    }
    return paths;
  }
  Json::IJsonValue Operation(std::string const &method, Json::JsonObject const &args) {
    if (method == "info") { Json::JsonObject info; info.SetNamedValue(L"privateRoot", String(root.wstring()));
      int count=0;auto argv=CommandLineToArgvW(GetCommandLineW(),&count);
      if(argv&&count>1&&fs::is_regular_file(argv[1])){auto extension=fs::path(argv[1]).extension().wstring();std::transform(extension.begin(),extension.end(),extension.begin(),::towlower);if(extension==L".mp4"||extension==L".mkv"||extension==L".webm"||extension==L".avi"||extension==L".mov"||extension==L".m4v")info.SetNamedValue(L"initialMedia",String(argv[1]));}
      if(argv)LocalFree(argv);return info; }
    if (method == "readText") return String(winrt::to_hstring(Read(Path(args.GetNamedString(L"path")))) .c_str());
    if (method == "readBytes") {
      auto bytes = Read(Path(args.GetNamedString(L"uri")));
      auto buffer = Crypto::CryptographicBuffer::CreateFromByteArray(winrt::array_view<uint8_t const>(reinterpret_cast<uint8_t const *>(bytes.data()), reinterpret_cast<uint8_t const *>(bytes.data()) + bytes.size()));
      return Json::JsonValue::CreateStringValue(Crypto::CryptographicBuffer::EncodeToBase64String(buffer));
    }
    if (method == "writeText") { Write(Owned(args.GetNamedString(L"path")), winrt::to_string(args.GetNamedString(L"value"))); return Null(); }
    if (method == "writeBytes") {
      auto buffer = Crypto::CryptographicBuffer::DecodeFromBase64String(args.GetNamedString(L"value")); winrt::com_array<uint8_t> bytes;
      Crypto::CryptographicBuffer::CopyToByteArray(buffer, bytes);
      Write(Owned(args.GetNamedString(L"uri")), std::string(reinterpret_cast<char const *>(bytes.data()), bytes.size())); return Null();
    }
    if (method == "exists") return Json::JsonValue::CreateBooleanValue(fs::exists(Path(args.GetNamedString(L"uri"))));
    if (method == "mkdir") { auto path = Path(args.GetNamedString(L"uri")); if (fs::weakly_canonical(path) != fs::weakly_canonical(root)) path = Owned(args.GetNamedString(L"uri")); fs::create_directories(path); return Null(); }
    if (method == "replace") {
      auto source = Owned(args.GetNamedString(L"staged")), destination = Owned(args.GetNamedString(L"destination"));
      if (source.parent_path() != destination.parent_path()) throw std::runtime_error("Atomic replacement requires same directory");
      if (!MoveFileExW(source.c_str(), destination.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) throw std::runtime_error("Cannot replace JSON snapshot"); return Null();
    }
    if (method == "removeOwned") { fs::remove_all(Owned(args.GetNamedString(L"uri"))); return Null(); }
    if (method == "list") {
      Json::JsonArray result;
      for (auto const &file : fs::directory_iterator(Path(args.GetNamedString(L"uri")))) {
        Json::JsonObject value; value.SetNamedValue(L"name", String(file.path().filename().wstring())); value.SetNamedValue(L"uri", String(file.path().wstring()));
        value.SetNamedValue(L"directory", Json::JsonValue::CreateBooleanValue(file.is_directory())); value.SetNamedValue(L"size", Json::JsonValue::CreateNumberValue(file.is_regular_file() ? static_cast<double>(file.file_size()) : 0)); result.Append(value);
      } return result;
    }
    if (method == "resolveChild") { auto path = Child(Path(args.GetNamedString(L"root")), args.GetNamedString(L"relativePath")); return fs::exists(path) ? String(path.wstring()) : Null(); }
    // Batch versions: one call for every title, so a library of hundreds of titles
    // does not pay a bridge round trip (or a folder listing) per folder.
    if (method == "scanMediaFolders") {
      auto parent = Path(args.GetNamedString(L"root"));
      if (!fs::is_directory(parent)) throw std::runtime_error("Selected media root is unavailable");
      Json::JsonArray existing, missing, skipped;
      for (auto const &value : args.GetNamedArray(L"folders")) {
        auto const folder = value.GetString();
        try {
          auto const target = MediaTarget(parent, folder);
          std::error_code error;
          if (fs::is_directory(target, error)) existing.Append(String(std::wstring(folder)));
          else if (!fs::exists(target, error)) missing.Append(String(std::wstring(folder)));
          else skipped.Append(String(std::wstring(folder)));
        } catch (...) { skipped.Append(String(std::wstring(folder))); }
      }
      Json::JsonObject result;
      result.SetNamedValue(L"existing", existing); result.SetNamedValue(L"missing", missing); result.SetNamedValue(L"skipped", skipped);
      return result;
    }
    if (method == "createMediaFolders") {
      auto parent = Path(args.GetNamedString(L"root"));
      if (!fs::is_directory(parent)) throw std::runtime_error("Selected media root is unavailable");
      double created = 0; Json::JsonArray failed;
      for (auto const &value : args.GetNamedArray(L"folders")) {
        auto const folder = value.GetString();
        try {
          auto target = MediaTarget(parent, folder);
          auto walk = parent;
          for (auto const &part : target.lexically_relative(parent)) {
            walk /= part;
            MediaTarget(parent, winrt::hstring(walk.lexically_relative(parent).wstring()));
            fs::create_directory(walk);
          }
          MediaTarget(parent, folder);
          created++;
        } catch (std::exception const &error) {
          Json::JsonObject row; row.SetNamedValue(L"folder", String(std::wstring(folder))); row.SetNamedValue(L"error", String(winrt::to_hstring(error.what()).c_str())); failed.Append(row);
        }
      }
      Json::JsonObject result;
      result.SetNamedValue(L"created", Json::JsonValue::CreateNumberValue(created)); result.SetNamedValue(L"failed", failed);
      return result;
    }
    if (method == "createMediaFolder") {
      auto parent = Path(args.GetNamedString(L"root"));
      if (!fs::is_directory(parent)) throw std::runtime_error("Selected media root is unavailable");
      auto target = MediaTarget(parent, args.GetNamedString(L"relativePath"));
      auto walk = parent;
      for (auto const &part : target.lexically_relative(parent)) {
        walk /= part;
        MediaTarget(parent, winrt::hstring(walk.lexically_relative(parent).wstring()));
        fs::create_directory(walk);
        MediaTarget(parent, winrt::hstring(walk.lexically_relative(parent).wstring()));
      }
      return String(target.wstring());
    }
    if (method == "deleteMediaFolder") {
      auto parent = Path(args.GetNamedString(L"root"));
      if (!Roots().count(parent.wstring())) throw std::runtime_error("Select the local media root first");
      auto target = MediaTarget(parent, args.GetNamedString(L"relativePath"));
      if (!fs::exists(target)) return Null();
      if (!fs::is_directory(target)) throw std::runtime_error("Expected a season folder");
      auto walk = parent;
      for (auto const &part : fs::relative(target, parent)) { walk /= part; if (GetFileAttributesW(walk.c_str()) & FILE_ATTRIBUTE_REPARSE_POINT) throw std::runtime_error("Relink junction/symlink media before deleting"); }
      for (auto const &entry : fs::recursive_directory_iterator(target)) if (GetFileAttributesW(entry.path().c_str()) & FILE_ATTRIBUTE_REPARSE_POINT) throw std::runtime_error("Media folder contains a junction/symlink");
      fs::remove_all(target); return Null();
    }
    if (method == "writePackage") return WritePackage(args);
    if (method == "unpackPackage") return UnpackPackage(args);
    if (method == "moveOwned") {
      auto source = Owned(args.GetNamedString(L"source")), destination = Owned(args.GetNamedString(L"destination"));
      fs::create_directories(destination.parent_path());
      if (!MoveFileExW(source.c_str(), destination.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_COPY_ALLOWED)) throw std::runtime_error("Could not move imported artwork");
      return Null();
    }
    if (method == "reveal") { auto path = Path(args.GetNamedString(L"uri")); ShellExecuteW(nullptr, L"open", path.c_str(), nullptr, nullptr, SW_SHOWNORMAL); return Null(); }
    if (method == "thumbnail") {
      EncodeWebp(Path(args.GetNamedString(L"source")), Owned(args.GetNamedString(L"destination")), static_cast<UINT>(args.GetNamedNumber(L"width")));
      return Null();
    }
    throw std::runtime_error("Unknown storage operation");
  }
  REACT_METHOD(Execute, L"execute")
  void Execute(std::string method, std::string json, winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept {
    if (method == "pickFolder" || method == "pickFiles" || method == "saveFile" || method == "pickSaveTarget") {
      context.UIDispatcher().Post([this, method, json, promise]() noexcept {
        try { promise.Resolve(winrt::to_string(Pick(method, Json::JsonObject::Parse(winrt::to_hstring(json))).Stringify())); }
        catch (std::exception const &error) { promise.Reject(error.what()); }
        catch (winrt::hresult_error const &error) { promise.Reject(error.message().c_str()); }
      });
    } else { Dispatch(method, json, promise); }
  }
  winrt::fire_and_forget Dispatch(std::string method, std::string json, winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept {
    co_await winrt::resume_background();
    try { promise.Resolve(winrt::to_string(Operation(method, Json::JsonObject::Parse(winrt::to_hstring(json))).Stringify())); }
    catch (std::exception const &error) { promise.Reject(error.what()); }
    catch (winrt::hresult_error const &error) { promise.Reject(error.message().c_str()); }
  }
};
