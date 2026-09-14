package com.sms.gateway.manager

import android.util.Log
import com.sms.gateway.GatewayApp
import com.sms.gateway.model.ClaimedMessage
import com.sms.gateway.model.InboundMessageInsert
import com.sms.gateway.model.PairingResult
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.rpc
import io.github.jan.supabase.realtime.Realtime
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import io.github.jan.supabase.realtime.realtime
import io.github.jan.supabase.realtime.PostgresAction
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

object SupabaseManager {
    private const val TAG = "SupabaseManager"
    private var client: SupabaseClient? = null

    fun getClient(): SupabaseClient? {
        if (client != null) return client
        val url = GatewayApp.instance.supabaseUrl ?: return null
        val anonKey = GatewayApp.instance.supabaseAnonKey ?: return null

        client = createSupabaseClient(url, anonKey) {
            install(Postgrest)
            install(Realtime)
        }
        return client
    }

    fun resetClient() {
        client = null
    }

    suspend fun completePairing(
        url: String,
        anonKey: String,
        pairingCode: String,
        deviceName: String,
        deviceTokenHash: String,
        androidVer: String,
        appVer: String
    ): PairingResult? = withContext(Dispatchers.IO) {
        try {
            val tempClient = createSupabaseClient(url, anonKey) {
                install(Postgrest)
            }
            val result = tempClient.postgrest.rpc(
                function = "complete_device_pairing",
                parameters = buildJsonObject {
                    put("p_pairing_code", pairingCode)
                    put("p_device_name", deviceName)
                    put("p_device_token_hash", deviceTokenHash)
                    put("p_android_ver", androidVer)
                    put("p_app_ver", appVer)
                }
            ).decodeList<PairingResult>()

            result.firstOrNull()
        } catch (e: Exception) {
            Log.e(TAG, "Pairing RPC failed", e)
            null
        }
    }

    suspend fun claimNextSms(): ClaimedMessage? = withContext(Dispatchers.IO) {
        val client = getClient() ?: return@withContext null
        val deviceId = GatewayApp.instance.deviceId ?: return@withContext null

        try {
            val results = client.postgrest.rpc(
                function = "claim_next_sms",
                parameters = buildJsonObject {
                    put("p_device_id", deviceId)
                }
            ).decodeList<ClaimedMessage>()

            results.firstOrNull()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to claim SMS from queue", e)
            null
        }
    }

    suspend fun reportSmsResult(
        messageId: String,
        status: String,
        errorCode: Int? = null,
        errorMessage: String? = null
    ) = withContext(Dispatchers.IO) {
        val client = getClient() ?: return@withContext
        val deviceId = GatewayApp.instance.deviceId ?: return@withContext

        try {
            client.postgrest.rpc(
                function = "report_sms_result",
                parameters = buildJsonObject {
                    put("p_message_id", messageId)
                    put("p_device_id", deviceId)
                    put("p_status", status)
                    if (errorCode != null) put("p_error_code", errorCode)
                    if (errorMessage != null) put("p_error_message", errorMessage)
                }
            )
            Log.d(TAG, "Reported result: $messageId -> $status")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to report SMS result", e)
        }
    }

    suspend fun recordHeartbeat(
        battery: Int,
        isCharging: Boolean,
        networkType: String,
        signalStrength: Int,
        appVersion: String
    ) = withContext(Dispatchers.IO) {
        val client = getClient() ?: return@withContext
        val deviceId = GatewayApp.instance.deviceId ?: return@withContext

        try {
            client.postgrest.rpc(
                function = "record_device_heartbeat",
                parameters = buildJsonObject {
                    put("p_device_id", deviceId)
                    put("p_battery", battery)
                    put("p_charging", isCharging)
                    put("p_network", networkType)
                    put("p_signal", signalStrength)
                    put("p_app_ver", appVersion)
                }
            )
        } catch (e: Exception) {
            Log.e(TAG, "Heartbeat update failed", e)
        }
    }

    suspend fun recordInboundSms(
        sender: String,
        message: String,
        simSlot: Int
    ) = withContext(Dispatchers.IO) {
        val client = getClient() ?: return@withContext
        val orgId = GatewayApp.instance.orgId ?: return@withContext
        val deviceId = GatewayApp.instance.deviceId ?: return@withContext

        try {
            client.postgrest["inbound_messages"].insert(
                InboundMessageInsert(
                    organizationId = orgId,
                    deviceId = deviceId,
                    simSlot = simSlot,
                    sender = sender,
                    message = message
                )
            )
            Log.d(TAG, "Recorded inbound SMS from $sender")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to record inbound SMS", e)
        }
    }

    fun subscribeToQueue(scope: CoroutineScope, onWakeup: () -> Unit) {
        val client = getClient() ?: return
        try {
            val channel = client.realtime.channel("gateway_queue")
            channel.postgresChangeFlow<PostgresAction.Insert>(schema = "public") {
                table = "outbound_messages"
            }.onEach {
                Log.d(TAG, "New message inserted in queue, waking up...")
                onWakeup()
            }.launchIn(scope)

            scope.launch(Dispatchers.IO) {
                channel.subscribe()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to subscribe to realtime queue", e)
        }
    }
}
