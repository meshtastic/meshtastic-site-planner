import type { CoverageResult } from './engine/CoverageEngine';

export interface Site {
    params: SplatParams;
    /** Unique id for list rendering (was the backend task id). */
    id: string;
    /** Cropped engine output; rendered via src/map/overlay.ts. */
    result: CoverageResult;
    /** Whether this site's overlay + marker are shown (#61). */
    visible: boolean;
}
export interface SplatParams {
    transmitter: {
        name: string;
        tx_lat: number;
        tx_lon: number;
        tx_power: number;
        tx_freq: number;
        tx_height: number;
        tx_gain: number;
    };
    receiver: {
        rx_sensitivity: number;
        rx_height: number;
        rx_gain: number;
        rx_loss: number;
    };
    environment: {
        radio_climate: string;
        polarization: string;
        clutter_height: number;
        ground_dielectric: number;
        ground_conductivity: number;
        atmosphere_bending: number;
    };
    simulation: {
        situation_fraction: number;
        time_fraction: number;
        simulation_extent: number;
        high_resolution: boolean;
    };
    display: {
        color_scale: string;
        min_dbm: number;
        max_dbm: number;
        overlay_transparency: number;
    };
}