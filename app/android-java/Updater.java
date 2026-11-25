package com.kiiwoom8.chwisik;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.ref.WeakReference;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/* Self-update (docs/DEVNOTES.md → App → Updates). The repo is public, so the app reads the newest build straight from
   GitHub Releases: android-latest/version.json ({"versionCode": N}, written by android.yml for release-signed builds)
   and then android-1.N/chwisik.apk. Every 3 hours at most, when the app comes to the front, it checks and downloads
   quietly into the app cache. The next time the app is opened it installs: the first time Android asks to allow
   "install unknown apps" for 취식 (our dialog explains it) and shows its install dialog; after that 취식 is the
   installer of record, so on Android 12+ later updates go through without a dialog (the app closes for a moment).
   A refused permission, a cancelled dialog or a failed install waits 24 hours before asking again. */
final class Updater {
    private static final String TAG = "chwisik-update";
    private static final String VERSION_URL = "https://github.com/kiiwoom8/chwisik/releases/download/android-latest/version.json";
    private static final String APK_URL = "https://github.com/kiiwoom8/chwisik/releases/download/android-1.%d/chwisik.apk";
    private static final long CHECK_EVERY = 3L * 3600_000L;
    private static final long WAIT_AFTER_NO = 24L * 3600_000L;

    private static volatile boolean fetching, installing;
    private static boolean dialogUp;
    private static WeakReference<Activity> front = new WeakReference<>(null);

    private Updater() {}

    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences("updater", Context.MODE_PRIVATE); }
    private static File file(Context c) { return new File(c.getCacheDir(), "update.apk"); }

    private static long code(PackageInfo p) { return Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode; }

    private static long installed(Context c) {
        try {
            return code(c.getPackageManager().getPackageInfo(c.getPackageName(), 0));
        } catch (PackageManager.NameNotFoundException e) {
            return Long.MAX_VALUE;
        }
    }

    static void onPause(Activity a) {
        if (front.get() == a) front = new WeakReference<>(null);
    }

    static void onResume(Activity a) {
        front = new WeakReference<>(a);
        Context app = a.getApplicationContext();
        SharedPreferences sp = prefs(app);
        long now = System.currentTimeMillis();
        long ready = sp.getLong("ready", 0);
        long have = installed(app);
        if (ready > 0 && ready <= have) {                 // installed (or older than what we have): clean up
            file(app).delete();
            sp.edit().remove("ready").remove("held").remove("asking").apply();
            ready = 0;
        }
        if (ready > 0 && file(app).exists()) {
            if (now - sp.getLong("held", 0) >= WAIT_AFTER_NO) install(a, ready);
            return;
        }
        if (fetching || now - sp.getLong("checked", 0) < CHECK_EVERY) return;
        fetching = true;
        new Thread(() -> {
            try {
                fetch(app);
            } catch (Exception e) {
                Log.w(TAG, "update check failed", e);
            } finally {
                fetching = false;
            }
        }, TAG).start();
    }

    /* background thread: newest version number, then the APK if it is newer than this one */
    private static void fetch(Context c) throws Exception {
        SharedPreferences sp = prefs(c);
        sp.edit().putLong("checked", System.currentTimeMillis()).apply();
        long newest = new JSONObject(new String(get(VERSION_URL), StandardCharsets.UTF_8)).getLong("versionCode");
        if (newest <= installed(c)) return;
        if (newest == sp.getLong("ready", 0) && file(c).exists()) return;
        File part = new File(c.getCacheDir(), "update.part");
        download(String.format(Locale.ROOT, APK_URL, newest), part);
        PackageInfo info = c.getPackageManager().getPackageArchiveInfo(part.getPath(), 0);
        if (info == null || !c.getPackageName().equals(info.packageName) || code(info) <= installed(c)) {
            part.delete();
            throw new IOException("not a newer 취식 APK");
        }
        File f = file(c);
        f.delete();
        if (!part.renameTo(f)) throw new IOException("cannot move the download");
        sp.edit().putLong("ready", code(info)).remove("held").remove("asking").apply();
        Log.i(TAG, "downloaded " + code(info) + "; installs on the next start");
    }

    private static HttpURLConnection open(String url) throws IOException {
        HttpURLConnection h = (HttpURLConnection) new URL(url).openConnection();
        h.setConnectTimeout(20_000);
        h.setReadTimeout(60_000);
        h.setInstanceFollowRedirects(true);   // github.com → release-assets host, both https
        h.setRequestProperty("User-Agent", "chwisik-android");
        if (h.getResponseCode() != 200) throw new IOException(url + " → HTTP " + h.getResponseCode());
        return h;
    }

    private static byte[] get(String url) throws IOException {
        HttpURLConnection h = open(url);
        try (InputStream in = h.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            for (int n; (n = in.read(buf)) > 0 && out.size() < 65536; ) out.write(buf, 0, n);
            return out.toByteArray();
        } finally {
            h.disconnect();
        }
    }

    private static void download(String url, File to) throws IOException {
        HttpURLConnection h = open(url);
        try (InputStream in = h.getInputStream(); OutputStream out = new FileOutputStream(to)) {
            byte[] buf = new byte[65536];
            for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
        } finally {
            h.disconnect();
        }
    }

    /* UI thread, app in front: permission first (our dialog → Android's switch), then PackageInstaller */
    private static void install(Activity a, long version) {
        if (installing || dialogUp) return;
        PackageManager pm = a.getPackageManager();
        SharedPreferences sp = prefs(a);
        if (Build.VERSION.SDK_INT >= 26 && !pm.canRequestPackageInstalls()) {
            if (sp.getBoolean("asking", false)) {          // back from the settings screen without allowing
                sp.edit().putBoolean("asking", false).putLong("held", System.currentTimeMillis()).apply();
                return;
            }
            dialogUp = true;
            new AlertDialog.Builder(a)
                    .setTitle("취식 앱 새 버전")
                    .setMessage("새 버전을 설치하려면 다음 화면에서 '이 출처 허용'을 켜고 뒤로 돌아오세요. 처음 한 번만 하면 돼요.")
                    .setPositiveButton("설정 열기", (d, w) -> {
                        sp.edit().putBoolean("asking", true).apply();
                        a.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + a.getPackageName())));
                    })
                    .setNegativeButton("나중에", (d, w) -> sp.edit().putLong("held", System.currentTimeMillis()).apply())
                    .setOnCancelListener(d -> sp.edit().putLong("held", System.currentTimeMillis()).apply())
                    .setOnDismissListener(d -> dialogUp = false)
                    .show();
            return;
        }
        sp.edit().putBoolean("asking", false).apply();
        installing = true;
        Toast.makeText(a, "새 버전(1." + version + ")으로 업데이트해요. 앱이 잠깐 닫힐 수 있어요.", Toast.LENGTH_LONG).show();
        Context app = a.getApplicationContext();
        new Thread(() -> {
            try {
                commit(app);
            } catch (Exception e) {
                Log.w(TAG, "install failed", e);
                installing = false;
                failed(app, e.getMessage());
            }
        }, TAG).start();
    }

    private static void commit(Context c) throws IOException {
        File f = file(c);
        PackageInstaller installer = c.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams p = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        p.setAppPackageName(c.getPackageName());
        p.setSize(f.length());
        if (Build.VERSION.SDK_INT >= 31) p.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        int id = installer.createSession(p);
        try (PackageInstaller.Session s = installer.openSession(id)) {
            try (InputStream in = new FileInputStream(f); OutputStream out = s.openWrite("chwisik.apk", 0, f.length())) {
                byte[] buf = new byte[65536];
                for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                s.fsync(out);
            }
            Intent done = new Intent(c, Done.class);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            s.commit(PendingIntent.getBroadcast(c, id, done, flags).getIntentSender());
        }
    }

    private static void failed(Context c, String msg) {
        prefs(c).edit().putLong("held", System.currentTimeMillis()).apply();
        Activity a = front.get();
        if (a != null) a.runOnUiThread(() ->
                Toast.makeText(a, "업데이트하지 못했어요" + (msg == null ? "" : ": " + msg), Toast.LENGTH_LONG).show());
    }

    /* PackageInstaller's answer: Android's confirmation when it asks for one (first update); otherwise done or failed */
    public static final class Done extends BroadcastReceiver {
        @Override
        public void onReceive(Context c, Intent i) {
            int status = i.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
            if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                Intent confirm = i.getParcelableExtra(Intent.EXTRA_INTENT);
                if (confirm != null) c.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                return;
            }
            installing = false;
            if (status == PackageInstaller.STATUS_SUCCESS) {
                file(c).delete();
                prefs(c).edit().remove("ready").remove("held").apply();
            } else if (status == PackageInstaller.STATUS_FAILURE_ABORTED) {
                prefs(c).edit().putLong("held", System.currentTimeMillis()).apply();   // 취소: ask again tomorrow
            } else {
                failed(c, i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE));
            }
        }
    }
}
