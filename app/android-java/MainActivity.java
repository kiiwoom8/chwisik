package com.kiiwoom8.chwisik;

import com.getcapacitor.BridgeActivity;

/* Replaces the MainActivity that `npx cap add android` generates (android.yml copies app/android-java/ over it).
   Only adds the self-update check (Updater.java, docs/DEVNOTES.md → App → Updates). */
public class MainActivity extends BridgeActivity {
    @Override
    public void onResume() {
        super.onResume();
        Updater.onResume(this);
    }

    @Override
    public void onPause() {
        Updater.onPause(this);
        super.onPause();
    }
}
