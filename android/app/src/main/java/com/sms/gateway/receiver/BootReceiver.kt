package com.sms.gateway.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.sms.gateway.GatewayApp
import com.sms.gateway.service.SmsGatewayService

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        Log.d(TAG, "BootReceiver received action: $action")
        if (action == Intent.ACTION_BOOT_COMPLETED ||
            action == Intent.ACTION_LOCKED_BOOT_COMPLETED ||
            action == Intent.ACTION_MY_PACKAGE_REPLACED ||
            action == "android.intent.action.QUICKBOOT_POWERON" ||
            action == "com.sms.gateway.SIMULATE_BOOT"
        ) {
            Log.d(TAG, "Device boot/startup event detected. Checking pairing status...")
            if (GatewayApp.instance.isPaired) {
                Log.d(TAG, "Device is paired. Auto-starting SmsGatewayService...")
                SmsGatewayService.start(context)
            } else {
                Log.w(TAG, "Device is not paired yet. Skipping auto-start.")
            }
        }
    }

    companion object {
        private const val TAG = "BootReceiver"
    }
}
