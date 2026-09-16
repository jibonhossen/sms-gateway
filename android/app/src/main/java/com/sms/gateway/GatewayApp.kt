package com.sms.gateway

import android.app.Application
import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class GatewayApp : Application() {

    lateinit var prefs: SharedPreferences
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this

        val masterKey = MasterKey.Builder(this)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

        prefs = EncryptedSharedPreferences.create(
            this,
            "gateway_secure_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    var supabaseUrl: String?
        get() = prefs.getString("supabase_url", null) ?: BuildConfig.DEFAULT_SUPABASE_URL.ifEmpty { null }
        set(value) = prefs.edit().putString("supabase_url", value).apply()

    var supabaseAnonKey: String?
        get() = prefs.getString("supabase_anon_key", null) ?: BuildConfig.DEFAULT_SUPABASE_ANON_KEY.ifEmpty { null }
        set(value) = prefs.edit().putString("supabase_anon_key", value).apply()

    var deviceId: String?
        get() = prefs.getString("device_id", null)
        set(value) = prefs.edit().putString("device_id", value).apply()

    var orgId: String?
        get() = prefs.getString("org_id", null)
        set(value) = prefs.edit().putString("org_id", value).apply()

    var orgName: String?
        get() = prefs.getString("org_name", null)
        set(value) = prefs.edit().putString("org_name", value).apply()

    var fcmToken: String?
        get() = prefs.getString("fcm_token", null)
        set(value) = prefs.edit().putString("fcm_token", value).apply()

    val isPaired: Boolean
        get() = !deviceId.isNullOrEmpty() && !supabaseUrl.isNullOrEmpty()

    fun clearAll() {
        prefs.edit().clear().apply()
    }

    companion object {
        lateinit var instance: GatewayApp
            private set
    }
}
