/*
 * Android app keys: SHA-256 (hex) of the key built into each APK. .github/workflows/android.yml makes a new random
 * key for every build, puts it only inside that APK (app/www/index.html, %%CHWISIK_APP_KEY%%) and adds its hash
 * here (commit by github-actions, then a deploy). redeemApp(key) in Code.gs turns a listed key into a device key, so
 * the app gets in without the 접근 코드 (owner, 2026-11-25: "pass 접근코드 for apk users").
 * The APK can be downloaded by anyone from the public Releases and its key read out of it, so having the APK = in.
 * Shut one build out: delete its line (that APK then asks for the 접근 코드). All of them: menu 안드로이드 앱 자동 접근.
 */
var APP_KEYS_ = [
  '1252ed690731b7e6213bd93e9da7b393616967aca27a98f8a03a45dea5870433', // android-1.9
];
