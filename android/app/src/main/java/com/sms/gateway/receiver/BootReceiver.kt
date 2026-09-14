package com.sms.gateway.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.sms.gateway.GatewayApp
import com.sms.gateway.service.SmsGatewayService

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED ||
            intent.action == "android.intent.action.QUICKBOOT_POWERON"
        ) {
            Log.d(TAG, "Device booted. Checking pairing status...")
            if (GatewayApp.instance.isPaired) {
                Log.d(TAG, "Auto-starting SmsGatewayService...")
                SmsGatewayService.start(context)
            }
        }
    }

    companion object {
        private const val TAG = "BootReceiver"
    }
}
