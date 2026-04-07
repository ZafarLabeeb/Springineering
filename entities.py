from orbit_physics import build_position_from_elements, position_update
from comms_logic import check_visibility, calculate_received_power
import numpy as np


class Satellite:
    def __init__(self, sat_id, n_vec, altitude_km, theta_deg):
        self.sat_id = str(sat_id)
        self.altitude_km = float(altitude_km)
        self.theta_deg = float(theta_deg)

        self.r_vec, self.n_hat = build_position_from_elements(
            np.array(n_vec, dtype=float), self.altitude_km, self.theta_deg
        )

        self.is_visible = False
        self.signal_dbm = -float("inf")
        self.distance_to_ground_m = None

    def move(self, dt):
        """Advances the satellite position by dt seconds."""
        self.r_vec = position_update(self.r_vec, self.n_hat, dt)

    def update_comms(self, ground_station_pos, ground_station_normal, p_t, g_t, g_r, freq):
        """Updates visibility and signal strength based on current position."""
        ground_station_pos = np.array(ground_station_pos, dtype=float)
        ground_station_normal = np.array(ground_station_normal, dtype=float)

        self.distance_to_ground_m = float(np.linalg.norm(self.r_vec - ground_station_pos))
        self.is_visible = check_visibility(self.r_vec, ground_station_pos, ground_station_normal)

        if self.is_visible:
            self.signal_dbm = calculate_received_power(p_t, g_t, g_r, self.distance_to_ground_m, freq)
        else:
            self.signal_dbm = -float("inf")

    def to_dict(self):
        return {
            "sat_id": self.sat_id,
            "altitude_km": self.altitude_km,
            "theta_deg": self.theta_deg,
            "position_m": {
                "x": float(self.r_vec[0]),
                "y": float(self.r_vec[1]),
                "z": float(self.r_vec[2]),
            },
            "orbit_normal": {
                "x": float(self.n_hat[0]),
                "y": float(self.n_hat[1]),
                "z": float(self.n_hat[2]),
            },
            "is_visible": bool(self.is_visible),
            "signal_dbm": None if not np.isfinite(self.signal_dbm) else float(self.signal_dbm),
            "distance_to_ground_m": self.distance_to_ground_m,
        }
