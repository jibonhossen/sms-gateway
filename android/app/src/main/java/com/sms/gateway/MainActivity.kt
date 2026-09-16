package com.sms.gateway

import android.content.Intent
import android.os.Bundle
import android.util.Log
import androidx.appcompat.app.AppCompatActivity
import androidx.fragment.app.Fragment
import com.sms.gateway.databinding.ActivityMainBinding
import com.sms.gateway.service.SmsGatewayService
import com.sms.gateway.ui.HomeFragment
import com.sms.gateway.ui.LogsFragment
import com.sms.gateway.ui.SettingsFragment

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val homeFragment = HomeFragment()
    private val logsFragment = LogsFragment()
    private val settingsFragment = SettingsFragment()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // If device is not paired, direct to Onboarding / Pairing flow
        if (!GatewayApp.instance.isPaired) {
            val intent = Intent(this, OnboardingActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            }
            startActivity(intent)
            finish()
            return
        }

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupBottomNavigation()

        // Start background relay service
        SmsGatewayService.start(this)

        if (savedInstanceState == null) {
            switchFragment(homeFragment)
        }
    }

    private fun setupBottomNavigation() {
        binding.bottomNavigation.setOnItemSelectedListener { item ->
            when (item.itemId) {
                R.id.nav_home -> {
                    switchFragment(homeFragment)
                    true
                }
                R.id.nav_logs -> {
                    switchFragment(logsFragment)
                    true
                }
                R.id.nav_settings -> {
                    switchFragment(settingsFragment)
                    true
                }
                else -> false
            }
        }
    }

    private fun switchFragment(fragment: Fragment) {
        supportFragmentManager.beginTransaction()
            .replace(R.id.nav_host_fragment, fragment)
            .commit()
    }

    override fun onResume() {
        super.onResume()
        if (!GatewayApp.instance.isPaired) {
            startActivity(Intent(this, OnboardingActivity::class.java))
            finish()
        }
    }

    companion object {
        private const val TAG = "MainActivity"
    }
}
