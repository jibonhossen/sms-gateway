package com.sms.gateway.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

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
