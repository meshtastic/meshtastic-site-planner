/* Nominal radio defaults for common Meshtastic devices, used by the optional
 * "Device" quick-fill in the transmitter form (issue #51).
 *
 * Each value is the board's typical *max* LoRa TX power (set by its LoRa chip)
 * plus an estimate for the STOCK antenna. These are starting points, not exact
 * specs: users should set gain to match their actual antenna and power to their
 * region's legal limit. Frequency is region-specific in Meshtastic (US 915 /
 * EU 868 / …), not a device property, so it is intentionally left untouched.
 *
 * Power figures derive from the LoRa transceiver: SX1262 ≈ 22 dBm (0.158 W),
 * SX1276 ≈ 17-20 dBm, and boards with an external PA go higher. Sources:
 * Meshtastic hardware docs (https://meshtastic.org/docs/hardware/devices/) and
 * the Semtech SX1262/SX1276 datasheets. To convert dBm to watts:
 * W = 10^((dBm - 30) / 10).
 */
export interface DeviceProfile {
  /** Display name shown in the dropdown. */
  label: string;
  /** Typical max TX power in watts (from the board's rated dBm). */
  tx_power: number;
  /** Stock-antenna gain estimate in dBi (adjust for your real antenna). */
  tx_gain: number;
}

export const DEVICE_PROFILES: DeviceProfile[] = [
  { label: 'Heltec WiFi LoRa 32 V3', tx_power: 0.126, tx_gain: 2 }, // SX1262, 21 dBm
  { label: 'Heltec WiFi LoRa 32 V4 (high-power)', tx_power: 0.63, tx_gain: 2 }, // SX1262, ~28 dBm
  { label: 'Heltec WiFi LoRa 32 V2', tx_power: 0.1, tx_gain: 3 }, // SX1276, ~20 dBm
  { label: 'LILYGO T-Beam (SX1262)', tx_power: 0.158, tx_gain: 2 }, // 22 dBm
  { label: 'LILYGO T-Beam Supreme', tx_power: 0.158, tx_gain: 2 }, // SX1262, 22 dBm
  { label: 'LILYGO T-Echo', tx_power: 0.158, tx_gain: 1 }, // SX1262, 22 dBm, small antenna
  { label: 'LILYGO T-Deck', tx_power: 0.158, tx_gain: 2 }, // SX1262, 22 dBm
  { label: 'RAK WisBlock (RAK4631)', tx_power: 0.158, tx_gain: 2 }, // SX1262, 22 dBm
  { label: 'Station G2', tx_power: 1.0, tx_gain: 3 }, // SX1262 + PA, ~30 dBm
  { label: 'Seeed SenseCAP T1000-E', tx_power: 0.158, tx_gain: 1 }, // SX1262, 22 dBm, PCB antenna
];
