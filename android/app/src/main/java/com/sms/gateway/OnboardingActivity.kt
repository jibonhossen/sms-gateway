package com.sms.gateway

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.google.firebase.messaging.FirebaseMessaging
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import com.sms.gateway.databinding.ActivityOnboardingBinding
import com.sms.gateway.manager.SupabaseManager
import com.sms.gateway.model.QrPairingPayload
import com.sms.gateway.service.SmsGatewayService
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.serialization.json.Json
import java.security.MessageDigest
import java.util.UUID

class OnboardingActivity : AppCompatActivity() {

    private lateinit var binding: ActivityOnboardingBinding

    private val requestPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        updateStepStates()
        val allGranted = permissions.entries.all { it.value }
        if (allGranted) {
            Toast.makeText(this, "All permissions granted!", Toast.LENGTH_SHORT).show()
        } else {
            Toast.makeText(this, "SMS permissions are necessary for relay operations", Toast.LENGTH_LONG).show()
        }
    }

    private val scanQrLauncher = registerForActivityResult(ScanContract()) { result ->
        if (result.contents != null) {
            handleQrScanned(result.contents)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityOnboardingBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupListeners()
        updateStepStates()
        fetchFcmToken()
    }

    override fun onResume() {
        super.onResume()
        updateStepStates()
    }

    private fun setupListeners() {
        // Step 1: Grant Permissions
        binding.btnGrantPermissions.setOnClickListener {
            val permissions = mutableListOf(
                Manifest.permission.SEND_SMS,
                Manifest.permission.RECEIVE_SMS,
                Manifest.permission.READ_PHONE_STATE,
                Manifest.permission.CAMERA
            )
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                permissions.add(Manifest.permission.POST_NOTIFICATIONS)
            }
            requestPermissionLauncher.launch(permissions.toTypedArray())
        }

        // Step 2: Exempt Battery
        binding.btnExemptBattery.setOnClickListener {
            val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
            if (!powerManager.isIgnoringBatteryOptimizations(packageName)) {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:$packageName")
                }
                startActivity(intent)
            } else {
                Toast.makeText(this, "Battery optimization already disabled!", Toast.LENGTH_SHORT).show()
            }
        }

        // Step 3: QR Scan
        binding.btnScanQr.setOnClickListener {
            val options = ScanOptions().apply {
                setPrompt("Scan Dashboard QR Code to Pair")
                setBeepEnabled(true)
                setOrientationLocked(true)
                setCaptureActivity(QrScanActivity::class.java)
            }
            scanQrLauncher.launch(options)
        }

        // Step 3: Pair With 6-Digit Code
        binding.btnPairWithCode.setOnClickListener {
            val rawCode = binding.etPairingCode.text?.toString()?.trim() ?: ""
            if (rawCode.isEmpty()) {
                binding.tilPairingCode.error = "Please enter 6-digit pairing code"
                return@setOnClickListener
            }
            binding.tilPairingCode.error = null

            val cleanedCode = rawCode.replace("-", "").replace(" ", "").trim()
            val url = GatewayApp.instance.supabaseUrl ?: BuildConfig.DEFAULT_SUPABASE_URL
            val anonKey = GatewayApp.instance.supabaseAnonKey ?: BuildConfig.DEFAULT_SUPABASE_ANON_KEY

            binding.btnPairWithCode.isEnabled = false
            binding.btnPairWithCode.text = "Pairing…"

            performPairing(url, anonKey, cleanedCode) { success ->
                binding.btnPairWithCode.isEnabled = true
                binding.btnPairWithCode.text = getString(R.string.pair_with_code)
                if (success) {
                    binding.etPairingCode.text?.clear()
                }
            }
        }
    }

    private fun updateStepStates() {
        // Step 1 Check
        val permList = mutableListOf(
            Manifest.permission.SEND_SMS,
            Manifest.permission.RECEIVE_SMS,
            Manifest.permission.READ_PHONE_STATE
        )
        val hasAllPerms = permList.all {
            ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
        }

        if (hasAllPerms) {
            binding.ivPermStatus.setImageResource(R.drawable.ic_check_circle)
            binding.btnGrantPermissions.text = getString(R.string.permissions_granted)
            binding.btnGrantPermissions.isEnabled = false
            binding.btnGrantPermissions.alpha = 0.6f
        } else {
            binding.ivPermStatus.setImageResource(R.drawable.ic_error_circle)
            binding.btnGrantPermissions.text = getString(R.string.grant_permissions)
            binding.btnGrantPermissions.isEnabled = true
            binding.btnGrantPermissions.alpha = 1.0f
        }

        // Step 2 Check
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        val isBatteryExempt = powerManager.isIgnoringBatteryOptimizations(packageName)

        if (isBatteryExempt) {
            binding.ivBatteryStatus.setImageResource(R.drawable.ic_check_circle)
            binding.btnExemptBattery.text = getString(R.string.battery_exempted)
            binding.btnExemptBattery.isEnabled = false
            binding.btnExemptBattery.alpha = 0.6f
        } else {
            binding.ivBatteryStatus.setImageResource(R.drawable.ic_error_circle)
            binding.btnExemptBattery.text = getString(R.string.exempt_battery)
            binding.btnExemptBattery.isEnabled = true
            binding.btnExemptBattery.alpha = 1.0f
        }
    }

    private fun fetchFcmToken() {
        lifecycleScope.launch {
            try {
                val token = FirebaseMessaging.getInstance().token.await()
                if (!token.isNullOrEmpty()) {
                    Log.d(TAG, "Initial FCM token retrieved: $token")
                    GatewayApp.instance.fcmToken = token
                }
            } catch (e: Exception) {
                Log.w(TAG, "Failed to retrieve initial FCM token", e)
            }
        }
    }

    private fun handleQrScanned(jsonStr: String) {
        Log.d(TAG, "handleQrScanned: $jsonStr")
        try {
            val payload = Json.decodeFromString<QrPairingPayload>(jsonStr)
            performPairing(payload.url, payload.anonKey, payload.pairingCode)
        } catch (e: Exception) {
            Log.e(TAG, "Error decoding QR payload", e)
            Toast.makeText(this, "Invalid QR code format: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    private fun performPairing(
        url: String,
        anonKey: String,
        pairingCode: String,
        onComplete: ((Boolean) -> Unit)? = null
    ) {
        lifecycleScope.launch {
            try {
                val deviceName = "${Build.MANUFACTURER} ${Build.MODEL}"
                val rawSecret = UUID.randomUUID().toString()

                val md = MessageDigest.getInstance("SHA-256")
                val hashBytes = md.digest(rawSecret.toByteArray())
                val hashHex = hashBytes.joinToString("") { "%02x".format(it) }

                val pairingResult = SupabaseManager.completePairing(
                    url = url,
                    anonKey = anonKey,
                    pairingCode = pairingCode,
                    deviceName = deviceName,
                    deviceTokenHash = hashHex,
                    androidVer = Build.VERSION.RELEASE,
                    appVer = "1.0.0"
                )

                if (pairingResult != null) {
                    Log.d(TAG, "Pairing success! Device ID: ${pairingResult.deviceId}")
                    GatewayApp.instance.supabaseUrl = url
                    GatewayApp.instance.supabaseAnonKey = anonKey
                    GatewayApp.instance.deviceId = pairingResult.deviceId
                    GatewayApp.instance.orgId = pairingResult.organizationId
                    GatewayApp.instance.orgName = pairingResult.orgName

                    // Sync FCM token if available
                    GatewayApp.instance.fcmToken?.let { token ->
                        SupabaseManager.updateFcmToken(token)
                    }

                    SupabaseManager.resetClient()
                    SmsGatewayService.start(this@OnboardingActivity)

                    Toast.makeText(this@OnboardingActivity, "Paired with ${pairingResult.orgName}!", Toast.LENGTH_SHORT).show()

                    val intent = Intent(this@OnboardingActivity, MainActivity::class.java).apply {
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
                    }
                    startActivity(intent)
                    finish()
                    onComplete?.invoke(true)
                } else {
                    Toast.makeText(this@OnboardingActivity, "Pairing failed. Code may be invalid or expired.", Toast.LENGTH_LONG).show()
                    onComplete?.invoke(false)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Pairing exception", e)
                Toast.makeText(this@OnboardingActivity, "Pairing error: ${e.message}", Toast.LENGTH_SHORT).show()
                onComplete?.invoke(false)
            }
        }
    }

    companion object {
        private const val TAG = "OnboardingActivity"
    }
}
