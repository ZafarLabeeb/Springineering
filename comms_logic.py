import math
import numpy as np


def check_visibility(sat_position, ground_station_pos, ground_station_normal):
    """Returns True when the satellite is above the ground station horizon."""
    sat_vec = np.array(sat_position, dtype=float)
    gs_pos = np.array(ground_station_pos, dtype=float)
    gs_normal = np.array(ground_station_normal, dtype=float)

    los_vec = sat_vec - gs_pos
    return float(np.dot(los_vec, gs_normal)) >= 0.0


def calculate_received_power(p_t, g_t, g_r, distance_m, freq_hz):
    """Calculates the received signal power in dBm using the Friis equation."""
    distance_m = float(distance_m)
    freq_hz = float(freq_hz)

    if distance_m <= 0.0 or freq_hz <= 0.0:
        return -float("inf")

    c = 299792458.0
    wavelength = c / freq_hz
    path_loss_factor = (wavelength / (4.0 * math.pi * distance_m)) ** 2
    p_r_watts = float(p_t) * float(g_t) * float(g_r) * path_loss_factor

    if p_r_watts <= 0.0:
        return -float("inf")

    return 10.0 * math.log10(p_r_watts * 1000.0)
