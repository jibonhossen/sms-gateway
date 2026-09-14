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
        get() = prefs.getString("supabase_url", null)
        set(value) = prefs.edit().putString("supabase_url", value).apply()

    var supabaseAnonKey: String?
        get() = prefs.getString("supabase_anon_key", null)
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

    val isPaired: Boolean
        get() = !supabaseUrl.isNullOrEmpty() && !deviceId.isNullOrEmpty()

    companion object {
        lateinit var instance: GatewayApp
            private set
    }
}
