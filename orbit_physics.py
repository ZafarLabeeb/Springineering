import numpy as np

MU_MOON = 4.9048695e12   # m^3/s^2
R_MOON = 1737e3          # meters
REF_GLOBAL = np.array([1.0, 0.0, 0.0], dtype=float)


def normalize(vec):
    """Returns a safely normalized copy of the input vector."""
    arr = np.array(vec, dtype=float)
    norm = np.linalg.norm(arr)
    if norm < 1e-12:
        raise ValueError("Cannot normalize a near-zero vector.")
    return arr / norm


def rotate_vector_about_axis(vec, axis_hat, angle_rad):
    """Rotates a vector around a unit axis using Rodrigues' formula."""
    v = np.array(vec, dtype=float)
    k = normalize(axis_hat)
    c = np.cos(angle_rad)
    s = np.sin(angle_rad)
    return v * c + np.cross(k, v) * s + k * np.dot(k, v) * (1.0 - c)


def orbital_angular_rate(radius_m):
    """Returns the circular-orbit angular rate in rad/s."""
    return np.sqrt(MU_MOON / (radius_m ** 3))


def orbital_period(radius_m):
    """Returns the circular-orbit period in seconds."""
    return (2.0 * np.pi) / orbital_angular_rate(radius_m)


def surface_vector_from_lat_lon(latitude_deg, longitude_deg, radius_m=1.0):
    """Returns a Moon-centered Cartesian vector from latitude/longitude.

    Coordinate convention:
    - +Z is lunar north.
    - Latitude is in degrees, from -90 to +90.
    - Longitude is in degrees, from -180 to +180.
    """
    lat_rad = np.radians(float(latitude_deg))
    lon_rad = np.radians(float(longitude_deg))

    cos_lat = np.cos(lat_rad)
    x = float(radius_m) * cos_lat * np.cos(lon_rad)
    y = float(radius_m) * cos_lat * np.sin(lon_rad)
    z = float(radius_m) * np.sin(lat_rad)
    return np.array([x, y, z], dtype=float)


def build_position_from_elements(n_vec, altitude_km, theta_deg):
    """Builds a circular-orbit position vector from plane normal, altitude, and phase angle."""
    n_hat = normalize(n_vec)
    r_mag = R_MOON + float(altitude_km) * 1000.0
    theta = np.radians(theta_deg)

    v1 = REF_GLOBAL - np.dot(REF_GLOBAL, n_hat) * n_hat
    if np.linalg.norm(v1) < 1e-8:
        alt_ref = np.array([0.0, 1.0, 0.0], dtype=float)
        v1 = alt_ref - np.dot(alt_ref, n_hat) * n_hat

    v1 = normalize(v1)
    v2 = np.cross(n_hat, v1)
    r_vec = r_mag * (np.cos(theta) * v1 + np.sin(theta) * v2)
    return r_vec, n_hat


def position_update(r_vec, n_vec, dt):
    """Advances a satellite along its circular orbit without Euler drift."""
    r_arr = np.array(r_vec, dtype=float)
    n_hat = normalize(n_vec)
    radius_m = np.linalg.norm(r_arr)

    if radius_m < 1e-12:
        raise ValueError("Satellite position magnitude is too small.")

    angle_rad = orbital_angular_rate(radius_m) * float(dt)
    return rotate_vector_about_axis(r_arr, n_hat, angle_rad)