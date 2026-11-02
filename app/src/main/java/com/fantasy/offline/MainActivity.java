package com.fantasy.offline;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.util.JsonReader;
import android.util.JsonToken;
import org.json.JSONObject;
import java.io.*;
import java.util.HashSet;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

public final class MainActivity extends Activity {
    private static final int PICK_DATA_PACK = 7301;
    private static final long MAX_UNPACKED = 700L * 1024L * 1024L;
    private static final long MAX_CARDS_JSON = 128L * 1024L * 1024L;
    private static final int MAX_ENTRIES = 40000;
    private WebView webView;
    private File dataDir;
    private final ExecutorService dataPackExecutor = Executors.newSingleThreadExecutor();

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        dataDir = new File(getFilesDir(), "fm1-card-data");
        getWindow().setStatusBarColor(Color.rgb(12,17,27));
        getWindow().setNavigationBarColor(Color.rgb(12,17,27));
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(12,17,27));
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setBlockNetworkLoads(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        webView.addJavascriptInterface(new DataPackBridge(), "FMNative");
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient());
        setContentView(webView);
        webView.loadUrl("file:///android_asset/game/index.html");
    }

    private final class DataPackBridge {
        @JavascriptInterface public String getCardsJson() {
            try {
                File f = new File(dataDir, "cards.json");
                if (!f.isFile() || f.length() > MAX_CARDS_JSON) return "[]";
                return readText(f);
            } catch (Exception e) { return "[]"; }
        }
        @JavascriptInterface public String getImageBaseUri() {
            return new File(dataDir, "images").toURI().toString();
        }
        @JavascriptInterface public String getDataPackInfo() {
            try {
                File mf = new File(dataDir, "manifest.json");
                if (!mf.isFile()) return "{\"installed\":false}";
                JSONObject m = new JSONObject(readText(mf));
                m.put("installed", true);
                return m.toString();
            } catch (Exception e) { return "{\"installed\":false}"; }
        }
        @JavascriptInterface public void openDataPackPicker() {
            runOnUiThread(() -> {
                try {
                    Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("*/*");
                    i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                        "application/zip", "application/x-zip-compressed",
                        "application/octet-stream", "application/x-zip"
                    });
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivityForResult(i, PICK_DATA_PACK);
                } catch (Exception e) {
                    notifyWeb("error", "파일 선택기를 열지 못했습니다: " + safeMessage(e));
                }
            });
        }

        @JavascriptInterface public void openDataPackDownload() {
            runOnUiThread(() -> {
                try {
                    Uri downloadUri = Uri.parse(
                        "https://github.com/dragonslayers-k/FM-OFFLINE/actions/workflows/android-ci.yml"
                    );
                    startActivity(new Intent(Intent.ACTION_VIEW, downloadUri));
                } catch (Exception e) {
                    notifyWeb("error", "카드 데이터 ZIP 다운로드 페이지를 열지 못했습니다: " + safeMessage(e));
                }
            });
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PICK_DATA_PACK || resultCode != RESULT_OK) return;
        if (data == null || data.getData() == null) {
            notifyWeb("error", "선택한 파일 정보를 가져오지 못했습니다.");
            return;
        }
        final Uri selectedUri = data.getData();
        notifyWeb("working", "데이터팩을 확인하고 있습니다. 용량에 따라 시간이 걸릴 수 있습니다.");
        try {
            dataPackExecutor.execute(() -> {
                try {
                    installDataPack(selectedUri);
                    notifyWeb("success", "카드 데이터팩을 설치했습니다.");
                } catch (Exception e) {
                    notifyWeb("error", safeMessage(e));
                } catch (OutOfMemoryError e) {
                    notifyWeb("error", "기기의 메모리가 부족해 데이터팩을 처리하지 못했습니다. 다른 앱을 종료한 뒤 다시 시도해 주십시오.");
                }
            });
        } catch (RuntimeException e) {
            notifyWeb("error", "데이터팩 작업을 시작하지 못했습니다: " + safeMessage(e));
        }
    }

    private void installDataPack(Uri uri) throws Exception {
        File staging = new File(getFilesDir(), "fm1-card-data-staging");
        if (staging.exists() && !deleteTree(staging)) throw new IOException("이전 임시 데이터 파일을 정리하지 못했습니다.");
        if (!staging.mkdirs() && !staging.isDirectory()) throw new IOException("임시 저장 공간을 만들 수 없습니다.");

        long total = 0;
        int entries = 0;
        byte[] buf = new byte[32768];
        InputStream raw = getContentResolver().openInputStream(uri);
        if (raw == null) throw new IOException("선택한 파일을 열 수 없습니다. 파일 앱에서 ZIP을 다시 선택해 주십시오.");

        try (InputStream input = raw;
             ZipInputStream zip = new ZipInputStream(new BufferedInputStream(input))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (++entries > MAX_ENTRIES) throw new IOException("ZIP 안의 파일 수가 허용 한도를 초과했습니다.");
                String name = entry.getName();
                if (name == null || name.trim().isEmpty() || name.indexOf('\0') >= 0 || name.indexOf('\\') >= 0) {
                    throw new IOException("ZIP 안에 올바르지 않은 파일 경로가 있습니다.");
                }
                File out = new File(staging, name);
                String root = staging.getCanonicalPath() + File.separator;
                String target = out.getCanonicalPath();
                if (!target.startsWith(root)) throw new IOException("ZIP에 저장 경로를 벗어나는 파일이 포함되어 있습니다.");
                if (entry.isDirectory()) {
                    if (!out.isDirectory() && !out.mkdirs()) throw new IOException("폴더를 만들 수 없습니다: " + name);
                } else {
                    File parent = out.getParentFile();
                    if (parent != null && !parent.isDirectory() && !parent.mkdirs()) throw new IOException("저장 폴더를 만들 수 없습니다.");
                    try (FileOutputStream fos = new FileOutputStream(out)) {
                        int n;
                        while ((n = zip.read(buf)) != -1) {
                            if (n == 0) continue;
                            total += n;
                            if (total > MAX_UNPACKED) throw new IOException("압축 해제 용량이 제한(700MB)을 초과했습니다.");
                            fos.write(buf, 0, n);
                        }
                    }
                }
                zip.closeEntry();
            }
        } catch (Exception e) {
            deleteTree(staging);
            throw e;
        }

        // Accept both ZIP layouts: files at archive root, or one enclosing
        // folder (for example FM1-CardData-v1.0.0/cards.json).
        // Keep all validation and final installation anchored to the detected payload.
        File packRoot = staging;
        if (!new File(packRoot, "cards.json").isFile()
                || !new File(packRoot, "manifest.json").isFile()
                || !new File(packRoot, "images").isDirectory()) {
            File[] children = staging.listFiles();
            File match = null;
            int matches = 0;
            if (children != null) {
                for (File child : children) {
                    if (child.isDirectory()
                            && new File(child, "cards.json").isFile()
                            && new File(child, "manifest.json").isFile()
                            && new File(child, "images").isDirectory()) {
                        match = child;
                        matches++;
                    }
                }
            }
            if (matches != 1) {
                deleteTree(staging);
                throw new IOException("데이터팩 ZIP에서 cards.json, manifest.json, images 폴더를 찾지 못했거나 데이터팩 폴더가 여러 개입니다. ZIP 구조를 확인해 주십시오.");
            }
            packRoot = match;
        }
        File cards = new File(packRoot, "cards.json");
        File manifest = new File(packRoot, "manifest.json");
        File imagesDir = new File(packRoot, "images");
        if (cards.length() <= 0 || cards.length() > MAX_CARDS_JSON) {
            deleteTree(staging);
            throw new IOException("카드 JSON 파일 크기가 올바르지 않습니다.");
        }

        JSONObject m;
        try { m = new JSONObject(readText(manifest)); }
        catch (Exception e) {
            deleteTree(staging);
            throw new IOException("manifest.json을 읽을 수 없습니다.");
        }
        if (!"FM1-CARD-DATA".equals(m.optString("format"))) {
            deleteTree(staging);
            throw new IOException("지원하지 않는 데이터팩 형식입니다.");
        }
        String expectedHash = m.optString("cardsSha256", "");
        if (expectedHash.length() != 64 || !sha256(cards).equalsIgnoreCase(expectedHash)) {
            deleteTree(staging);
            throw new IOException("카드 DB 무결성 검증에 실패했습니다. 파일이 손상되지 않았는지 확인해 주십시오.");
        }

        int images = countFiles(imagesDir);
        int declaredCards = m.optInt("cardsCount", 0);
        int declaredImages = m.optInt("imagesCount", 0);
        if (declaredCards != 15350 || declaredImages != 15350 || images != declaredImages) {
            deleteTree(staging);
            throw new IOException("FM1 원본 데이터팩은 카드 15,350장과 일러스트 15,350개가 필요합니다.");
        }
        validateCardRecords(cards, imagesDir, declaredCards);
        m.put("installedCards", declaredCards);
        m.put("installedImages", images);
        try (FileOutputStream fos = new FileOutputStream(manifest)) {
            fos.write(m.toString(2).getBytes("UTF-8"));
            fos.getFD().sync();
        }

        File backup = new File(getFilesDir(), "fm1-card-data-backup");
        if (backup.exists() && !deleteTree(backup)) {
            deleteTree(staging);
            throw new IOException("기존 백업 데이터를 정리하지 못했습니다.");
        }
        boolean hadOld = dataDir.exists();
        if (hadOld && !dataDir.renameTo(backup)) {
            deleteTree(staging);
            throw new IOException("기존 데이터팩을 백업할 수 없습니다.");
        }
        if (!packRoot.renameTo(dataDir)) {
            if (hadOld && backup.exists()) backup.renameTo(dataDir);
            deleteTree(staging);
            throw new IOException("새 데이터팩을 적용할 수 없습니다. 저장 공간을 확인해 주십시오.");
        }
        // If the archive used an enclosing directory, remove the now-empty wrapper.
        if (!packRoot.equals(staging)) deleteTree(staging);
        if (backup.exists()) deleteTree(backup);
    }

    private static void validateCardRecords(File cardsFile, File imagesDir, int expectedCount) throws Exception {
        HashSet<String> ids = new HashSet<>(expectedCount * 2);
        int[] typeCounts = new int[5]; // land, unit, item, spell, enchant
        String[] types = new String[]{"land", "unit", "item", "spell", "enchant"};
        int total = 0;
        String imageRoot = imagesDir.getCanonicalPath() + File.separator;

        try (JsonReader reader = new JsonReader(new InputStreamReader(new FileInputStream(cardsFile), "UTF-8"))) {
            boolean objectRoot = reader.peek() == JsonToken.BEGIN_OBJECT;
            if (objectRoot) {
                reader.beginObject();
                boolean foundCards = false;
                while (reader.hasNext()) {
                    String rootKey = reader.nextName();
                    if ("cards".equals(rootKey) && reader.peek() == JsonToken.BEGIN_ARRAY) {
                        foundCards = true;
                        break;
                    }
                    reader.skipValue();
                }
                if (!foundCards) throw new IOException("cards.json 객체에 cards 배열이 없습니다.");
            } else {
                reader.beginArray();
            }
            while (reader.hasNext()) {
                String id = null, name = null, type = null, artImage = null;
                reader.beginObject();
                while (reader.hasNext()) {
                    String key = reader.nextName();
                    if ("id".equals(key) || "name".equals(key) || "type".equals(key) || "artImage".equals(key)) {
                        if (reader.peek() == JsonToken.STRING) {
                            String value = reader.nextString();
                            if ("id".equals(key)) id = value;
                            else if ("name".equals(key)) name = value;
                            else if ("type".equals(key)) type = value;
                            else artImage = value;
                        } else reader.skipValue();
                    } else reader.skipValue();
                }
                reader.endObject();

                if (id == null || id.trim().isEmpty() || name == null || name.trim().isEmpty()) {
                    throw new IOException("카드 ID 또는 이름이 누락된 원본 레코드가 있습니다. 레코드 " + (total + 1));
                }
                if (!ids.add(id)) throw new IOException("중복된 원본 카드 ID가 있습니다: " + id);

                int typeIndex = -1;
                for (int i = 0; i < types.length; i++) if (types[i].equals(type)) { typeIndex = i; break; }
                if (typeIndex < 0) throw new IOException("지원하지 않는 원본 카드 종류입니다: " + type + " (" + id + ")");
                typeCounts[typeIndex]++;

                if (artImage == null || artImage.trim().isEmpty()) {
                    throw new IOException("일러스트 경로가 누락된 카드입니다: " + id);
                }
                String fileName = new File(artImage).getName();
                if (!fileName.matches("[A-Za-z0-9_-]+\\.(?i:png|jpg|jpeg|webp)")) {
                    throw new IOException("올바르지 않은 카드 일러스트 경로입니다: " + id);
                }
                File image = new File(imagesDir, fileName);
                String canonicalImage = image.getCanonicalPath();
                if (!canonicalImage.startsWith(imageRoot) || !image.isFile()) {
                    throw new IOException("카드 일러스트 파일을 찾을 수 없습니다: " + id + " / " + fileName);
                }
                total++;
            }
            reader.endArray();
            if (objectRoot) {
                while (reader.hasNext()) {
                    reader.nextName();
                    reader.skipValue();
                }
                reader.endObject();
            }
            if (reader.peek() != JsonToken.END_DOCUMENT) {
                throw new IOException("cards.json 뒤에 불필요한 데이터가 있습니다.");
            }
        }

        if (total != expectedCount || ids.size() != expectedCount) {
            throw new IOException("카드 엔트리 수가 맞지 않습니다. 확인 " + total + " / 기준 " + expectedCount);
        }
        int[] expectedTypes = new int[]{289, 8633, 1748, 3857, 823};
        for (int i = 0; i < types.length; i++) {
            if (typeCounts[i] != expectedTypes[i]) {
                throw new IOException(types[i] + " 카드 수량이 원본 기준과 다릅니다: " + typeCounts[i] + " / " + expectedTypes[i]);
            }
        }
    }

    private void notifyWeb(String status, String message) {
        WebView view = webView;
        if (view == null) return;
        String js = "window.onNativeDataPackResult && window.onNativeDataPackResult(" +
            JSONObject.quote(status) + "," + JSONObject.quote(message) + ");";
        view.post(() -> {
            if (webView != null) webView.evaluateJavascript(js, null);
        });
    }

    private static String safeMessage(Exception e) {
        String message = e.getMessage();
        return message == null || message.trim().isEmpty() ? "데이터팩을 처리하지 못했습니다. ZIP 파일과 저장 공간을 확인해 주십시오." : message;
    }

    private static String readText(File f) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream((int)Math.min(f.length(), 1024L * 1024L));
        try (InputStream in = new FileInputStream(f)) {
            byte[] b = new byte[32768];
            int n;
            while ((n = in.read(b)) != -1) if (n > 0) out.write(b, 0, n);
        }
        return out.toString("UTF-8");
    }

    private static String sha256(File f) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(f)) {
            byte[] b = new byte[32768];
            int n;
            while ((n = in.read(b)) != -1) if (n > 0) md.update(b, 0, n);
        }
        StringBuilder s = new StringBuilder();
        for (byte x : md.digest()) s.append(String.format(Locale.US, "%02x", x & 0xff));
        return s.toString();
    }

    private static int countFiles(File dir) throws IOException {
        File[] files = dir.listFiles();
        if (files == null) throw new IOException("이미지 폴더를 읽을 수 없습니다.");
        int n = 0;
        for (File f : files) {
            if (f.isDirectory()) n += countFiles(f);
            else if (f.isFile()) n++;
        }
        return n;
    }

    private static boolean deleteTree(File f) {
        if (!f.exists()) return true;
        File[] children = f.listFiles();
        if (children != null) for (File child : children) if (!deleteTree(child)) return false;
        return f.delete();
    }

    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        dataPackExecutor.shutdownNow();
        if (webView != null) {
            webView.stopLoading();
            webView.loadUrl("about:blank");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
