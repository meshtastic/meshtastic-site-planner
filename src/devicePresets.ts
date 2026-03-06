export interface DevicePreset {
    id: string;
    name: string;
    tx_power: number | null; // Watts
    tx_gain: number | null;  // dB
    rx_sensitivity: number | null; // dB
    rx_gain: number | null;  // dB
}

export const meshtasticDevices: DevicePreset[] = [
    {
        id: 'custom',
        name: 'Custom / Manual Entry',
        tx_power: 0.1,
        tx_gain: 2,
        rx_sensitivity: -130,
        rx_gain: 2
    },
    // RAK
    {
        id: 'rak_wisblock_4631',
        name: 'RAK WisBlock Core RAK4631 (Assumed 2dBi Antenna)',
        tx_power: 0.158,
        tx_gain: 2.0,
        rx_sensitivity: -130,
        rx_gain: 2.0
    },
    {
        id: 'rak_wisblock_11310',
        name: 'RAK WisBlock Core RAK11310 (Assumed 2dBi Antenna)',
        tx_power: 0.158,
        tx_gain: 2.0,
        rx_sensitivity: -130,
        rx_gain: 2.0
    },
    {
        id: 'rak_wisblock_3312',
        name: 'RAK WisBlock Core RAK3312 (Assumed 2dBi Antenna)',
        tx_power: 0.158,
        tx_gain: 2.0,
        rx_sensitivity: -130,
        rx_gain: 2.0
    },
    {
        id: 'rak_wismesh_pocket_v2',
        name: 'RAK WisMesh Pocket V2 (Stock Antenna)',
        tx_power: 0.158,
        tx_gain: 2.0,
        rx_sensitivity: -130,
        rx_gain: 2.0
    },
    {
        id: 'rak_wismesh_pocket_mini',
        name: 'RAK WisMesh Pocket Mini (Internal Antenna)',
        tx_power: 0.158,
        tx_gain: 1.0,
        rx_sensitivity: -130,
        rx_gain: 1.0
    },
    {
        id: 'rak_wismesh_tag',
        name: 'RAK WisMesh Tag (Internal Antenna)',
        tx_power: 0.158,
        tx_gain: 1.0,
        rx_sensitivity: -130,
        rx_gain: 1.0
    },
    {
        id: 'rak_wismesh_1w_booster',
        name: 'RAK WisMesh 1W Booster (Assumed 2dBi Antenna)',
        tx_power: 1.0,
        tx_gain: 2.0,
        rx_sensitivity: -130,
        rx_gain: 2.0
    },
    // LILYGO
    {
        id: 'lilygo_tbeam_s3',
        name: 'LILYGO T-Beam S3-Core (Assumed 2dBi Antenna)',
        tx_power: 0.158,
        tx_gain: 2.0,
        rx_sensitivity: -130,
        rx_gain: 2.0
    },
    {
        id: 'lilygo_techo',
        name: 'LILYGO T-Echo (Internal Antenna)',
        tx_power: 0.158,
        tx_gain: 1.0,
        rx_sensitivity: -130,
        rx_gain: 1.0
    },
    {
        id: 'lilygo_tdeck',
        name: 'LILYGO T-Deck (Internal Antenna)',
        tx_power: 0.158,
        tx_gain: 1.0,
        rx_sensitivity: -130,
        rx_gain: 1.0
    },
    {
        id: 'lilygo_tdeck_plus',
        name: 'LILYGO T-Deck Plus (Internal Antenna)',
        tx_power: 0.158,
        tx_gain: 1.0,
        rx_sensitivity: -130,
        rx_gain: 1.0
    },
    {
        id: 'lilygo_tdeck_pro',
        name: 'LILYGO T-Deck Pro (Internal Antenna)',
        tx_power: 0.158,
        tx_gain: 1.0,
        rx_sensitivity: -130,
        rx_gain: 1.0
    },
    // HelTec
    {
        id: 'heltec_lora32_v3',
        name: 'HelTec LoRa 32 V3 (Assumed 2dBi Antenna)',
        tx_power: 0.126,
        tx_gain: 2.0,
        rx_sensitivity: -134,
        rx_gain: 2.0
    },
    {
        id: 'heltec_lora32_v4',
        name: 'HelTec LoRa 32 V4 (Assumed 2dBi Antenna)',
        tx_power: 0.158,
        tx_gain: 2.0,
        rx_sensitivity: -137,
        rx_gain: 2.0
    },
    {
        id: 'heltec_meshpocket',
        name: 'HelTec MeshPocket (Internal Antenna)',
        tx_power: 0.158,
        tx_gain: 1.0,
        rx_sensitivity: -130,
        rx_gain: 1.0
    },
    // Seeed Studio
    {
        id: 'seeed_sensecap_t1000e',
        name: 'Seeed Studio SenseCAP Card Tracker T1000-E (Internal Antenna)',
        tx_power: 0.158,
        tx_gain: 1.0,
        rx_sensitivity: -130,
        rx_gain: 1.0
    },
    {
        id: 'seeed_sensecap_solar',
        name: 'Seeed Studio SenseCAP Solar Node (Assumed 2dBi Antenna)',
        tx_power: 0.158,
        tx_gain: 2.0,
        rx_sensitivity: -130,
        rx_gain: 2.0
    },
    {
        id: 'seeed_wio_l1',
        name: 'Seeed Studio Wio Tracker L1 (Stock Antenna)',
        tx_power: 0.158,
        tx_gain: 2.0,
        rx_sensitivity: -130,
        rx_gain: 2.0
    },
    // B&Q Consulting
    {
        id: 'bq_nano_g2_ultra',
        name: 'B&Q Consulting Nano G2 Ultra (Stock Antenna)',
        tx_power: 0.158,
        tx_gain: 2.0,
        rx_sensitivity: -130,
        rx_gain: 2.0
    },
    {
        id: 'bq_station_g2',
        name: 'B&Q Consulting Station G2 (Included 18.5dBi Antenna)',
        tx_power: 4.46,
        tx_gain: 18.5,
        rx_sensitivity: -130,
        rx_gain: 18.5
    },
    // Elecrow
    {
        id: 'elecrow_thinknode_m1',
        name: 'Elecrow ThinkNode M1 (Stock Antenna)',
        tx_power: 0.158,
        tx_gain: 2.5,
        rx_sensitivity: -130,
        rx_gain: 2.5
    },
    {
        id: 'elecrow_thinknode_m2',
        name: 'Elecrow ThinkNode M2 (Stock Antenna)',
        tx_power: 0.158,
        tx_gain: 2.0,
        rx_sensitivity: -130,
        rx_gain: 2.0
    },
    {
        id: 'elecrow_thinknode_m3',
        name: 'Elecrow ThinkNode M3 (Internal Antenna)',
        tx_power: 0.158,
        tx_gain: 1.0,
        rx_sensitivity: -130,
        rx_gain: 1.0
    },
    // muzi works
    {
        id: 'muzi_r1_neo',
        name: 'muzi works R1 Neo (Stock Antenna)',
        tx_power: 0.158,
        tx_gain: 3.5,
        rx_sensitivity: -130,
        rx_gain: 3.5
    },
    {
        id: 'muzi_base_uno',
        name: 'muzi works Base Uno (Assumed 2dBi Antenna)',
        tx_power: 0.158,
        tx_gain: 2.0,
        rx_sensitivity: -130,
        rx_gain: 2.0
    },
    {
        id: 'muzi_base_duo',
        name: 'muzi works Base Duo (Assumed 2dBi Antenna)',
        tx_power: 0.158,
        tx_gain: 2.0,
        rx_sensitivity: -130,
        rx_gain: 2.0
    }
];