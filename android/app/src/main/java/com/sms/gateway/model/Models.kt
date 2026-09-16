package com.sms.gateway.model

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Serializable
data class QrPairingPayload(
    @SerialName("url") val url: String,
    @SerialName("anonKey") val anonKey: String,
    @SerialName("code") val pairingCode: String
)

@Serializable
data class ClaimedMessage(
    @SerialName("message_id") val messageId: String,
    @SerialName("organization_id") val organizationId: String,
    @SerialName("phone_number") val phoneNumber: String,
    @SerialName("message") val message: String,
    @SerialName("sim_subscription_id") val simSubscriptionId: String,
    @SerialName("sim_slot") val simSlot: Int
)

@Serializable
data class PairingResult(
    @SerialName("device_id") val deviceId: String,
    @SerialName("organization_id") val organizationId: String,
    @SerialName("org_name") val orgName: String
)

@Serializable
data class InboundMessageInsert(
    @SerialName("organization_id") val organizationId: String,
    @SerialName("device_id") val deviceId: String,
    @SerialName("sim_slot") val simSlot: Int,
    @SerialName("sender") val sender: String,
    @SerialName("message") val message: String
)

data class ActivityLog(
    val id: String,
    val phoneNumber: String,
    val message: String,
    val simSlot: Int,
    val status: String, // 'QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'INBOUND'
    val timestamp: Long = System.currentTimeMillis(),
    val error: String? = null
) {
    val formattedTime: String
        get() = SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date(timestamp))
}

object ActivityLogManager {
    private val _logs = MutableStateFlow<List<ActivityLog>>(emptyList())
    val logs: StateFlow<List<ActivityLog>> = _logs.asStateFlow()

    fun addLog(log: ActivityLog) {
        val current = _logs.value.toMutableList()
        current.add(0, log)
        if (current.size > 100) {
            current.removeAt(current.lastIndex)
        }
        _logs.value = current
    }

    fun updateStatus(id: String, newStatus: String, error: String? = null) {
        val current = _logs.value.toMutableList()
        val index = current.indexOfFirst { it.id == id }
        if (index != -1) {
            val item = current[index]
            current[index] = item.copy(
                status = newStatus,
                error = error ?: item.error
            )
            _logs.value = current
        }
    }
}
