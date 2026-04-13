import argparse
import json
import mimetypes
import random
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import numpy as np

from entities import Satellite
from orbit_physics import R_MOON, surface_vector_from_lat_lon

FREQ_HZ = 2.4e9
P_T = 15.0
G_T = 2.0
G_R = 2.0

ALT_RANGE_KM = (500.0, 2000.0)
DEFAULT_FIXED_ALTITUDE_KM = 1200.0
MAX_SATS = 500

BASE_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"
INDEX_FILE = TEMPLATES_DIR / "index.html"


def clamp(value, low, high):
    return max(low, min(high, value))


def wrap_longitude(longitude_deg):
    wrapped = ((float(longitude_deg) + 180.0) % 360.0) - 180.0
    if wrapped == -180.0 and float(longitude_deg) > 0.0:
        return 180.0
    return wrapped


class LunarSimulation:
    def __init__(self):
        self.time_seconds = 0.0
        self.fleet = []

        self.base_station_lat_deg = 90.0
        self.base_station_lon_deg = 0.0
        self.ground_station_normal = np.array([0.0, 0.0, 1.0], dtype=float)
        self.ground_station_pos = self.ground_station_normal * R_MOON

        self.random_altitudes = False
        self.fixed_altitude_km = DEFAULT_FIXED_ALTITUDE_KM

        self.set_ground_station(self.base_station_lat_deg, self.base_station_lon_deg)
        self.deploy(100, altitude_mode="fixed", fixed_altitude_km=self.fixed_altitude_km)

    def set_ground_station(self, latitude_deg=None, longitude_deg=None):
        if latitude_deg is not None:
            self.base_station_lat_deg = clamp(float(latitude_deg), -90.0, 90.0)
        if longitude_deg is not None:
            self.base_station_lon_deg = wrap_longitude(float(longitude_deg))

        self.ground_station_normal = surface_vector_from_lat_lon(
            self.base_station_lat_deg,
            self.base_station_lon_deg,
            radius_m=1.0,
        )
        self.ground_station_pos = self.ground_station_normal * R_MOON
        self._refresh_comms()
        return self.get_state()

    def _refresh_comms(self):
        for sat in self.fleet:
            sat.update_comms(
                self.ground_station_pos,
                self.ground_station_normal,
                P_T,
                G_T,
                G_R,
                FREQ_HZ,
            )

    def deploy(self, num_sats, altitude_mode=None, fixed_altitude_km=None):
        num_sats = int(clamp(int(num_sats), 1, MAX_SATS))

        if altitude_mode is not None:
            self.random_altitudes = str(altitude_mode).lower() == "random"

        if fixed_altitude_km is not None:
            self.fixed_altitude_km = float(clamp(float(fixed_altitude_km), ALT_RANGE_KM[0], ALT_RANGE_KM[1]))

        self.time_seconds = 0.0
        self.fleet = []

        for i in range(num_sats):
            name = f"Sat-{i + 1:03d}"
            n_vec = [random.uniform(-1.0, 1.0) for _ in range(3)]
            theta = random.uniform(0.0, 360.0)
            altitude_km = (
                random.uniform(*ALT_RANGE_KM)
                if self.random_altitudes
                else self.fixed_altitude_km
            )

            sat = Satellite(
                sat_id=name,
                n_vec=n_vec,
                altitude_km=altitude_km,
                theta_deg=theta,
            )
            self.fleet.append(sat)

        self._refresh_comms()
        return self.get_state()

    def step(self, dt):
        dt = float(clamp(float(dt), 0.0, 300.0))
        self.time_seconds += dt

        for sat in self.fleet:
            sat.move(dt)
            sat.update_comms(
                self.ground_station_pos,
                self.ground_station_normal,
                P_T,
                G_T,
                G_R,
                FREQ_HZ,
            )

        return self.get_state()

    def get_state(self):
        visible_sats = [sat for sat in self.fleet if sat.is_visible]
        best_sat = max(visible_sats, key=lambda sat: sat.signal_dbm, default=None)

        tracked_link = None
        if best_sat is not None:
            tracked_link = {
                "sat_id": best_sat.sat_id,
                "signal_dbm": round(best_sat.signal_dbm, 3),
                "distance_km": round(best_sat.distance_to_ground_m / 1000.0, 3),
            }

        return {
            "time_seconds": round(self.time_seconds, 3),
            "num_sats": len(self.fleet),
            "visible_count": len(visible_sats),
            "best_sat_name": None if best_sat is None else best_sat.sat_id,
            "best_signal_dbm": None if best_sat is None else round(best_sat.signal_dbm, 3),
            "connection_status": "Connected" if best_sat is not None else "No connection",
            "tracked_link": tracked_link,
            "settings": {
                "random_altitudes": bool(self.random_altitudes),
                "fixed_altitude_km": round(self.fixed_altitude_km, 3),
                "altitude_min_km": ALT_RANGE_KM[0],
                "altitude_max_km": ALT_RANGE_KM[1],
            },
            "constants": {
                "moon_radius_m": R_MOON,
                "ground_station": {
                    "x": float(self.ground_station_pos[0]),
                    "y": float(self.ground_station_pos[1]),
                    "z": float(self.ground_station_pos[2]),
                    "latitude_deg": round(self.base_station_lat_deg, 3),
                    "longitude_deg": round(self.base_station_lon_deg, 3),
                    "normal": {
                        "x": float(self.ground_station_normal[0]),
                        "y": float(self.ground_station_normal[1]),
                        "z": float(self.ground_station_normal[2]),
                    },
                },
            },
            "satellites": [sat.to_dict() for sat in self.fleet],
        }


simulation = LunarSimulation()


class SimulatorRequestHandler(BaseHTTPRequestHandler):
    def _read_json_body(self):
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length <= 0:
            return {}
        raw = self.rfile.read(content_length)
        if not raw:
            return {}
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}

    def _send_json(self, payload, status=HTTPStatus.OK):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_file(self, file_path, content_type=None, status=HTTPStatus.OK):
        data = file_path.read_bytes()
        guessed_type, _ = mimetypes.guess_type(str(file_path))
        mime_type = content_type or guessed_type or "application/octet-stream"
        self.send_response(status)
        self.send_header("Content-Type", mime_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _static_file_for_path(self, request_path):
        relative_path = request_path.lstrip("/")
        candidate = (STATIC_DIR / relative_path).resolve()
        static_root = STATIC_DIR.resolve()
        if static_root not in candidate.parents and candidate != static_root:
            return None
        if candidate.is_file():
            return candidate
        return None

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/state":
            self._send_json(simulation.get_state())
            return

        if path in ("/", "/index.html"):
            self._send_file(INDEX_FILE, content_type="text/html; charset=utf-8")
            return

        static_file = self._static_file_for_path(path)
        if static_file is not None:
            self._send_file(static_file)
            return

        self.send_error(HTTPStatus.NOT_FOUND, "Resource not found")

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        payload = self._read_json_body()

        if path == "/api/deploy":
            num_sats = payload.get("num_sats", 100)
            altitude_mode = payload.get("altitude_mode", "fixed")
            fixed_altitude_km = payload.get("fixed_altitude_km", simulation.fixed_altitude_km)
            try:
                num_sats = int(num_sats)
            except (TypeError, ValueError):
                num_sats = 100
            try:
                fixed_altitude_km = float(fixed_altitude_km)
            except (TypeError, ValueError):
                fixed_altitude_km = simulation.fixed_altitude_km
            self._send_json(
                simulation.deploy(
                    num_sats=num_sats,
                    altitude_mode=altitude_mode,
                    fixed_altitude_km=fixed_altitude_km,
                )
            )
            return

        if path == "/api/step":
            dt = payload.get("dt", 0.0)
            try:
                dt = float(dt)
            except (TypeError, ValueError):
                dt = 0.0
            self._send_json(simulation.step(dt))
            return

        if path == "/api/ground-station":
            latitude_deg = payload.get("latitude_deg", simulation.base_station_lat_deg)
            longitude_deg = payload.get("longitude_deg", simulation.base_station_lon_deg)
            try:
                latitude_deg = float(latitude_deg)
            except (TypeError, ValueError):
                latitude_deg = simulation.base_station_lat_deg
            try:
                longitude_deg = float(longitude_deg)
            except (TypeError, ValueError):
                longitude_deg = simulation.base_station_lon_deg
            self._send_json(simulation.set_ground_station(latitude_deg, longitude_deg))
            return

        self.send_error(HTTPStatus.NOT_FOUND, "API endpoint not found")

    def log_message(self, format_str, *args):
        return


def run_console_simulation(num_sats=50, dt=100.0, total_steps=10):
    sim = LunarSimulation()
    sim.deploy(num_sats, altitude_mode="fixed", fixed_altitude_km=sim.fixed_altitude_km)

    print("=== LUNAR CONSTELLATION SETUP ===")
    print(f"Satellites: {num_sats}")
    print(f"Physics dt: {dt} s")
    print(f"Steps: {total_steps}")
    print(
        f"Base station: lat {sim.base_station_lat_deg:.1f}°, "
        f"lon {sim.base_station_lon_deg:.1f}°"
    )
    print(
        f"Altitude mode: {'random' if sim.random_altitudes else f'fixed at {sim.fixed_altitude_km:.1f} km'}\n"
    )

    for _ in range(total_steps):
        state = sim.step(dt)
        print(f"[TIME: {state['time_seconds']:.1f}s]")
        print(f"Connected Satellites: {state['visible_count']} / {state['num_sats']}")
        if state["best_sat_name"] is None:
            print("Strongest Signal: NO CONNECTION (Total Blackout)\n")
        else:
            print(
                f"Strongest Signal: {state['best_signal_dbm']:.2f} dBm "
                f"(Tracking {state['best_sat_name']})\n"
            )
        time.sleep(0.2)

    print("--- Simulation Finished ---")


def run_web_app(host="127.0.0.1", port=5000):
    server = ThreadingHTTPServer((host, port), SimulatorRequestHandler)
    print(f"Moon simulator running at http://{host}:{port}/")
    print("Open that address in your browser.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
    finally:
        server.server_close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Moon satellite simulator")
    parser.add_argument("--cli", action="store_true", help="Run the console simulation instead of the browser app")
    parser.add_argument("--num-sats", type=int, default=50, help="Satellite count for CLI mode")
    parser.add_argument("--dt", type=float, default=100.0, help="Time step in seconds for CLI mode")
    parser.add_argument("--steps", type=int, default=10, help="Number of steps for CLI mode")
    parser.add_argument("--host", default="127.0.0.1", help="Host for the web server")
    parser.add_argument("--port", type=int, default=5000, help="Port for the web server")
    args = parser.parse_args()

    if args.cli:
        run_console_simulation(num_sats=args.num_sats, dt=args.dt, total_steps=args.steps)
    else:
        run_web_app(host=args.host, port=args.port)