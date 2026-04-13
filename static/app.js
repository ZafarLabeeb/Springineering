const stateStore = {
    simState: null,
    running: true,
    inFlight: false,
    cameraYaw: 0.85,
    cameraPitch: -0.32,
    zoom: 1.0,
    lastStepTs: performance.now(),
    stars: [],
    textures: {
        moon: null,
        earth: null,
    },
    signalHistory: [],
    maxHistoryPoints: 600,
    pendingGroundStation: null,
    showOrbitLines: false,
    orbitLineCache: [],
};

const canvas = document.getElementById("simCanvas");
const ctx = canvas.getContext("2d");
const signalCanvas = document.getElementById("signalCanvas");
const signalCtx = signalCanvas.getContext("2d");

const satCountInput = document.getElementById("satCount");
const altitudeSlider = document.getElementById("altitudeSlider");
const randomAltitudeToggle = document.getElementById("randomAltitudeToggle");
const orbitLinesToggle = document.getElementById("orbitLinesToggle");
const physicsDtInput = document.getElementById("physicsDt");
const simSpeedInput = document.getElementById("simSpeed");
const stationLatitudeInput = document.getElementById("stationLatitude");
const stationLatitudeNumber = document.getElementById("stationLatitudeNumber");
const stationLongitudeInput = document.getElementById("stationLongitude");
const stationLongitudeNumber = document.getElementById("stationLongitudeNumber");

const deployButton = document.getElementById("deployButton");
const pauseButton = document.getElementById("pauseButton");

const satCountValue = document.getElementById("satCountValue");
const altitudeValue = document.getElementById("altitudeValue");
const altitudeModeHint = document.getElementById("altitudeModeHint");
const physicsDtValue = document.getElementById("physicsDtValue");
const simSpeedValue = document.getElementById("simSpeedValue");

const connectedStat = document.getElementById("connectedStat");
const signalStat = document.getElementById("signalStat");
const trackingStat = document.getElementById("trackingStat");
const timeStat = document.getElementById("timeStat");
const baseStationStat = document.getElementById("baseStationStat");
const baseStatusStat = document.getElementById("baseStatusStat");
const distanceStat = document.getElementById("distanceStat");
const signalTrackingStat = document.getElementById("signalTrackingStat");

const tabButtons = Array.from(document.querySelectorAll(".tab-btn"));
const tabPanels = Array.from(document.querySelectorAll(".tab-panel"));

const CAMERA_DISTANCE = 28.0e6;
const ALTITUDE_VISUAL_GAIN = 1.85;

function clamp(value, minValue, maxValue) {
    return Math.max(minValue, Math.min(maxValue, value));
}

function wrapLongitude(value) {
    let wrapped = Number(value);
    while (wrapped > 180) wrapped -= 360;
    while (wrapped < -180) wrapped += 360;
    return wrapped;
}

function vecLength(point) {
    return Math.hypot(point.x, point.y, point.z);
}

function normalizePoint(point) {
    const length = vecLength(point);
    if (length < 1e-9) {
        return { x: 0, y: 0, z: 1 };
    }
    return {
        x: point.x / length,
        y: point.y / length,
        z: point.z / length,
    };
}

function dotPoint(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

function crossPoint(a, b) {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}

function subtractPoint(a, b) {
    return {
        x: a.x - b.x,
        y: a.y - b.y,
        z: a.z - b.z,
    };
}

function scalePoint(point, scalar) {
    return {
        x: point.x * scalar,
        y: point.y * scalar,
        z: point.z * scalar,
    };
}

function addPoint(a, b) {
    return {
        x: a.x + b.x,
        y: a.y + b.y,
        z: a.z + b.z,
    };
}

function updateSliderLabels() {
    satCountValue.textContent = String(satCountInput.value);
    altitudeValue.textContent = `${Math.round(Number(altitudeSlider.value))} km`;
    physicsDtValue.textContent = `${Number(physicsDtInput.value).toFixed(1)} s`;
    simSpeedValue.textContent = `${parseInt(simSpeedInput.value, 10)}x`;

    const randomMode = randomAltitudeToggle.checked;
    altitudeSlider.disabled = randomMode;
    altitudeModeHint.textContent = randomMode
        ? "Random altitude mode is enabled. The altitude slider is ignored until you turn this off and deploy again."
        : "With this off, every satellite uses the same altitude while orbital planes remain random.";
}

function syncSettingsFromState(state) {
    if (!state || !state.settings) {
        return;
    }

    const settings = state.settings;
    const fixedAltitude = Number(settings.fixed_altitude_km);
    altitudeSlider.min = String(settings.altitude_min_km);
    altitudeSlider.max = String(settings.altitude_max_km);
    altitudeSlider.value = String(fixedAltitude);
    randomAltitudeToggle.checked = Boolean(settings.random_altitudes);
    updateSliderLabels();
}

function setActiveTab(tabId) {
    for (const button of tabButtons) {
        const isActive = button.dataset.tabTarget === tabId;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-selected", isActive ? "true" : "false");
    }

    for (const panel of tabPanels) {
        panel.classList.toggle("active", panel.id === tabId);
    }

    if (tabId === "signalTab") {
        resizeSignalCanvas();
        renderSignalGraph();
    }
}

function setBaseStationControls(latitudeDeg, longitudeDeg) {
    const lat = clamp(Number(latitudeDeg), -90, 90);
    const lon = wrapLongitude(Number(longitudeDeg));

    stationLatitudeInput.value = String(Math.round(lat));
    stationLatitudeNumber.value = lat.toFixed(1);
    stationLongitudeInput.value = String(Math.round(lon));
    stationLongitudeNumber.value = lon.toFixed(1);
}

function syncBaseStationInputs(source) {
    if (source === "lat-range") {
        stationLatitudeNumber.value = Number(stationLatitudeInput.value).toFixed(1);
    } else if (source === "lat-number") {
        const parsed = Number(stationLatitudeNumber.value);
        if (!Number.isFinite(parsed)) {
            return false;
        }
        const value = clamp(parsed, -90, 90);
        stationLatitudeNumber.value = value.toFixed(1);
        stationLatitudeInput.value = String(Math.round(value));
    } else if (source === "lon-range") {
        stationLongitudeNumber.value = Number(stationLongitudeInput.value).toFixed(1);
    } else if (source === "lon-number") {
        const parsed = Number(stationLongitudeNumber.value);
        if (!Number.isFinite(parsed)) {
            return false;
        }
        const value = wrapLongitude(parsed);
        stationLongitudeNumber.value = value.toFixed(1);
        stationLongitudeInput.value = String(Math.round(value));
    }
    return true;
}

function queueGroundStationUpdate() {
    if (!stateStore.simState) {
        return;
    }

    const latitudeDeg = Number(stationLatitudeNumber.value);
    const longitudeDeg = Number(stationLongitudeNumber.value);
    if (!Number.isFinite(latitudeDeg) || !Number.isFinite(longitudeDeg)) {
        return;
    }

    const payload = {
        latitude_deg: clamp(latitudeDeg, -90, 90),
        longitude_deg: wrapLongitude(longitudeDeg),
    };

    const current = stateStore.simState.constants.ground_station;
    const sameAsCurrent = Math.abs(payload.latitude_deg - current.latitude_deg) < 0.01
        && Math.abs(payload.longitude_deg - current.longitude_deg) < 0.01;

    stateStore.pendingGroundStation = sameAsCurrent ? null : payload;
}

function resizeCanvas() {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * ratio);
    canvas.height = Math.floor(rect.height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    if (!stateStore.stars.length) {
        generateStars(rect.width, rect.height);
    }
}

function resizeSignalCanvas() {
    const rect = signalCanvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
        return;
    }

    const ratio = window.devicePixelRatio || 1;
    signalCanvas.width = Math.floor(rect.width * ratio);
    signalCanvas.height = Math.floor(rect.height * ratio);
    signalCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function generateStars(width, height) {
    stateStore.stars = [];
    for (let i = 0; i < 260; i += 1) {
        stateStore.stars.push({
            x: Math.random() * width,
            y: Math.random() * height,
            r: Math.random() * 1.7 + 0.2,
            a: Math.random() * 0.75 + 0.18,
        });
    }
}

async function getJson(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
    }
    return response.json();
}

async function postJson(url, payload) {
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
    }
    return response.json();
}

function recordSignalSample(state, reset = false) {
    if (reset) {
        stateStore.signalHistory = [];
    }

    const sample = {
        timeSeconds: Number(state.time_seconds || 0),
        rawDbm: state.best_signal_dbm === null ? null : Number(state.best_signal_dbm),
    };

    const history = stateStore.signalHistory;
    const last = history[history.length - 1];
    if (last && Math.abs(last.timeSeconds - sample.timeSeconds) < 1e-9) {
        history[history.length - 1] = sample;
    } else {
        history.push(sample);
    }

    if (history.length > stateStore.maxHistoryPoints) {
        history.splice(0, history.length - stateStore.maxHistoryPoints);
    }
}

function updateStats(state) {
    connectedStat.textContent = `${state.visible_count} / ${state.num_sats}`;
    signalStat.textContent = state.best_signal_dbm === null
        ? "No connection"
        : `${state.best_signal_dbm.toFixed(2)} dBm`;
    trackingStat.textContent = state.best_sat_name || "None";
    timeStat.textContent = `${state.time_seconds.toFixed(1)} s`;

    const gs = state.constants.ground_station;
    baseStationStat.textContent = `Lat ${gs.latitude_deg.toFixed(1)}°, Lon ${gs.longitude_deg.toFixed(1)}°`;
    baseStatusStat.textContent = state.connection_status;
    distanceStat.textContent = state.tracked_link
        ? `${state.tracked_link.distance_km.toFixed(1)} km`
        : "--";
    signalTrackingStat.textContent = state.best_sat_name || "None";
}

function rotatePoint(point) {
    const cosYaw = Math.cos(stateStore.cameraYaw);
    const sinYaw = Math.sin(stateStore.cameraYaw);
    const cosPitch = Math.cos(stateStore.cameraPitch);
    const sinPitch = Math.sin(stateStore.cameraPitch);

    const x1 = point.x * cosYaw - point.z * sinYaw;
    const z1 = point.x * sinYaw + point.z * cosYaw;

    const y2 = point.y * cosPitch - z1 * sinPitch;
    const z2 = point.y * sinPitch + z1 * cosPitch;

    return { x: x1, y: y2, z: z2 };
}

function projectPoint(point, sceneScale, width, height) {
    const rotated = rotatePoint(point);
    const cx = width / 2;
    const cy = height / 2;
    const depth = CAMERA_DISTANCE - rotated.z;
    const safeDepth = Math.max(depth, 1.0e6);
    const perspective = CAMERA_DISTANCE / safeDepth;

    return {
        x: cx + rotated.x * sceneScale * perspective,
        y: cy - rotated.y * sceneScale * perspective,
        z: rotated.z,
        perspective,
    };
}

function drawStars(width, height) {
    for (const star of stateStore.stars) {
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${star.a})`;
        ctx.fill();
    }

    ctx.fillStyle = "rgba(10, 18, 34, 0.38)";
    ctx.fillRect(0, 0, width, height);
}

function drawFallbackBody(cx, cy, radiusPx, colors) {
    const gradient = ctx.createRadialGradient(
        cx - radiusPx * 0.32,
        cy - radiusPx * 0.42,
        radiusPx * 0.16,
        cx,
        cy,
        radiusPx
    );
    for (const stop of colors) {
        gradient.addColorStop(stop[0], stop[1]);
    }

    ctx.beginPath();
    ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
}

function drawTexturedBody(cx, cy, radiusPx, textureImage, options = {}) {
    const {
        textureOffset = 0,
        fallbackColors = [[0, "#d8dee8"], [0.4, "#adb7c6"], [1, "#4a5667"]],
        rimColor = "rgba(255,255,255,0.14)",
        glowColor = null,
    } = options;

    if (glowColor) {
        const glow = ctx.createRadialGradient(cx, cy, radiusPx * 0.8, cx, cy, radiusPx * 1.55);
        glow.addColorStop(0, glowColor);
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.beginPath();
        ctx.arc(cx, cy, radiusPx * 1.5, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();
    }

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
    ctx.clip();

    if (textureImage) {
        const drawSize = radiusPx * 2.18;
        const wrappedOffset = ((textureOffset % 1) + 1) % 1;
        const shiftPx = wrappedOffset * drawSize;
        const drawX = cx - radiusPx - shiftPx;
        const drawY = cy - radiusPx;

        ctx.drawImage(textureImage, drawX, drawY, drawSize, drawSize);
        ctx.drawImage(textureImage, drawX + drawSize, drawY, drawSize, drawSize);
    } else {
        drawFallbackBody(cx, cy, radiusPx, fallbackColors);
    }

    ctx.restore();

    const shading = ctx.createRadialGradient(
        cx - radiusPx * 0.42,
        cy - radiusPx * 0.5,
        radiusPx * 0.12,
        cx,
        cy,
        radiusPx
    );
    shading.addColorStop(0, "rgba(255,255,255,0.22)");
    shading.addColorStop(0.46, "rgba(255,255,255,0.03)");
    shading.addColorStop(1, "rgba(0,0,0,0.52)");

    ctx.beginPath();
    ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
    ctx.fillStyle = shading;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1.2, radiusPx * 0.018);
    ctx.strokeStyle = rimColor;
    ctx.stroke();
}

function drawEarthBackdrop(width, height, earthReferenceRadiusPx, simTimeSeconds) {
    const x = width * 0.77 + Math.sin(stateStore.cameraYaw * 0.8) * width * 0.045;
    const y = height * 0.24 + stateStore.cameraPitch * height * 0.05;
    const earthTextureOffset = simTimeSeconds / 12000;

    drawTexturedBody(x, y, earthReferenceRadiusPx, stateStore.textures.earth, {
        textureOffset: earthTextureOffset,
        fallbackColors: [[0, "#d1ecff"], [0.3, "#5fa8ff"], [0.72, "#27627d"], [1, "#102030"]],
        rimColor: "rgba(170,220,255,0.24)",
        glowColor: "rgba(82, 196, 255, 0.24)",
    });
}

function drawBaseStationModel(projected, connected, centerX, centerY) {
    const outwardAngle = Math.atan2(projected.y - centerY, projected.x - centerX);
    const rotation = outwardAngle + Math.PI / 2;
    const scale = Math.max(0.85, projected.perspective * 1.05);

    ctx.save();
    ctx.translate(projected.x, projected.y);
    ctx.rotate(rotation);
    ctx.scale(scale, scale);

    ctx.shadowBlur = connected ? 16 : 10;
    ctx.shadowColor = connected ? "rgba(68, 214, 255, 0.55)" : "rgba(68, 214, 255, 0.35)";

    ctx.fillStyle = "#3a4658";
    ctx.fillRect(-1.8, -13, 3.6, 13);

    ctx.shadowBlur = 0;

    ctx.fillStyle = "#c8d2df";
    ctx.beginPath();
    ctx.ellipse(0, -15.5, 8.5, 5.8, 0, Math.PI, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, -15.5, 8.5, 5.8, 0, Math.PI, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "#ff9a34";
    ctx.fillRect(-1.2, -22, 2.4, 7.5);

    ctx.beginPath();
    ctx.arc(0, 0, 3.8, 0, Math.PI * 2);
    ctx.fillStyle = connected ? "#67f2ff" : "#44d6ff";
    ctx.shadowBlur = 12;
    ctx.shadowColor = "rgba(68, 214, 255, 0.7)";
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.restore();
}

function drawConnectionLine(fromPoint, toPoint) {
    ctx.save();
    const gradient = ctx.createLinearGradient(fromPoint.x, fromPoint.y, toPoint.x, toPoint.y);
    gradient.addColorStop(0, "rgba(68, 214, 255, 0.75)");
    gradient.addColorStop(1, "rgba(255, 214, 107, 0.82)");
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 7]);
    ctx.beginPath();
    ctx.moveTo(fromPoint.x, fromPoint.y);
    ctx.lineTo(toPoint.x, toPoint.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
}

function drawSatelliteDot(projected, sat) {
    const radius = Math.max(2.2, 3.4 * projected.perspective);
    ctx.beginPath();
    ctx.arc(projected.x, projected.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = sat.is_visible ? "#69f0a8" : "#ff6b6b";
    ctx.shadowBlur = 10;
    ctx.shadowColor = ctx.fillStyle;
    ctx.fill();
    ctx.shadowBlur = 0;
}

function getVisualSatellitePoint(sat, moonRadiusM) {
    const actualPoint = {
        x: sat.position_m.x,
        y: sat.position_m.y,
        z: sat.position_m.z,
    };
    const direction = normalizePoint(actualPoint);
    const visualRadius = moonRadiusM + Number(sat.altitude_km) * 1000 * ALTITUDE_VISUAL_GAIN;
    return scalePoint(direction, visualRadius);
}

function buildOrbitLineCache(state) {
    const moonRadiusM = state.constants.moon_radius_m;
    stateStore.orbitLineCache = state.satellites.map((sat) => {
        const normal = normalizePoint(sat.orbit_normal);
        const currentPoint = getVisualSatellitePoint(sat, moonRadiusM);
        let v1 = subtractPoint(currentPoint, scalePoint(normal, dotPoint(currentPoint, normal)));
        if (vecLength(v1) < 1e-6) {
            const fallback = Math.abs(normal.x) < 0.8
                ? { x: 1, y: 0, z: 0 }
                : { x: 0, y: 1, z: 0 };
            v1 = subtractPoint(fallback, scalePoint(normal, dotPoint(fallback, normal)));
        }
        v1 = normalizePoint(v1);
        const v2 = normalizePoint(crossPoint(normal, v1));
        const orbitRadius = moonRadiusM + Number(sat.altitude_km) * 1000 * ALTITUDE_VISUAL_GAIN;

        const points = [];
        const segments = 64;
        for (let i = 0; i <= segments; i += 1) {
            const angle = (Math.PI * 2 * i) / segments;
            const point = addPoint(
                scalePoint(v1, orbitRadius * Math.cos(angle)),
                scalePoint(v2, orbitRadius * Math.sin(angle))
            );
            points.push(point);
        }

        return {
            satId: sat.sat_id,
            points,
        };
    });
}

function isPointHiddenByMoon(projected, centerX, centerY, moonScreenRadius) {
    const dx = projected.x - centerX;
    const dy = projected.y - centerY;
    const insideMoonDisk = Math.hypot(dx, dy) < moonScreenRadius * 0.975;
    return insideMoonDisk && projected.z < 0;
}

function drawOrbitLines(sceneScale, width, height, centerX, centerY, moonScreenRadius) {
    if (!stateStore.showOrbitLines || stateStore.orbitLineCache.length === 0) {
        return;
    }

    ctx.save();
    ctx.lineWidth = 1.15;
    ctx.strokeStyle = "rgba(143, 184, 255, 0.18)";

    for (const orbit of stateStore.orbitLineCache) {
        let drawing = false;

        for (const point of orbit.points) {
            const projected = projectPoint(point, sceneScale, width, height);
            const hidden = isPointHiddenByMoon(projected, centerX, centerY, moonScreenRadius);

            if (hidden) {
                if (drawing) {
                    ctx.stroke();
                    drawing = false;
                }
                continue;
            }

            if (!drawing) {
                ctx.beginPath();
                ctx.moveTo(projected.x, projected.y);
                drawing = true;
            } else {
                ctx.lineTo(projected.x, projected.y);
            }
        }

        if (drawing) {
            ctx.stroke();
        }
    }

    ctx.restore();
}

function render() {
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    ctx.clearRect(0, 0, width, height);
    drawStars(width, height);

    const state = stateStore.simState;
    if (!state) {
        return;
    }

    const moonRadiusM = state.constants.moon_radius_m;
    const baseScale = (Math.min(width, height) * 0.18) / moonRadiusM;
    const sceneScale = baseScale * stateStore.zoom;
    const moonScreenRadius = moonRadiusM * sceneScale;
    const baseMoonRadius = moonRadiusM * baseScale;
    const earthScreenRadius = baseMoonRadius * 0.54;
    const centerX = width / 2;
    const centerY = height / 2;

    drawEarthBackdrop(width, height, earthScreenRadius, state.time_seconds);

    const moonTextureOffset = stateStore.cameraYaw / (Math.PI * 2);
    drawTexturedBody(centerX, centerY, moonScreenRadius, stateStore.textures.moon, {
        textureOffset: moonTextureOffset,
        fallbackColors: [[0, "#d8dee8"], [0.35, "#adb7c6"], [1, "#495566"]],
        rimColor: "rgba(255,255,255,0.12)",
    });

    drawOrbitLines(sceneScale, width, height, centerX, centerY, moonScreenRadius);

    const projectedGround = projectPoint(state.constants.ground_station, sceneScale, width, height);
    const groundOnFront = projectedGround.z > 0;

    const projectedSats = state.satellites.map((sat) => {
        const visualPoint = getVisualSatellitePoint(sat, moonRadiusM);
        const projected = projectPoint(visualPoint, sceneScale, width, height);
        const hiddenBehindMoon = isPointHiddenByMoon(projected, centerX, centerY, moonScreenRadius);
        return { sat, projected, hiddenBehindMoon };
    });

    projectedSats.sort((a, b) => a.projected.z - b.projected.z);

    if (groundOnFront) {
        drawBaseStationModel(projectedGround, state.connection_status === "Connected", centerX, centerY);
    }

    const trackedSatellite = projectedSats.find((item) => item.sat.sat_id === state.best_sat_name);
    if (trackedSatellite && !trackedSatellite.hiddenBehindMoon && groundOnFront) {
        drawConnectionLine(projectedGround, trackedSatellite.projected);
    }

    for (const item of projectedSats) {
        if (item.hiddenBehindMoon) {
            continue;
        }
        drawSatelliteDot(item.projected, item.sat);
    }
}

function drawGraphGrid(plot, yMin, yMax, minTime, maxTime) {
    signalCtx.strokeStyle = "rgba(255,255,255,0.08)";
    signalCtx.lineWidth = 1;

    const horizontalLines = 4;
    const verticalLines = 5;

    for (let i = 0; i <= horizontalLines; i += 1) {
        const y = plot.top + (plot.height * i) / horizontalLines;
        signalCtx.beginPath();
        signalCtx.moveTo(plot.left, y);
        signalCtx.lineTo(plot.left + plot.width, y);
        signalCtx.stroke();

        const value = yMax - ((yMax - yMin) * i) / horizontalLines;
        signalCtx.fillStyle = "#9eb0c8";
        signalCtx.textAlign = "right";
        signalCtx.fillText(value.toFixed(1), plot.left - 8, y + 4);
    }

    for (let i = 0; i <= verticalLines; i += 1) {
        const x = plot.left + (plot.width * i) / verticalLines;
        signalCtx.beginPath();
        signalCtx.moveTo(x, plot.top);
        signalCtx.lineTo(x, plot.top + plot.height);
        signalCtx.stroke();

        const timeValue = minTime + ((maxTime - minTime) * i) / verticalLines;
        signalCtx.fillStyle = "#9eb0c8";
        signalCtx.textAlign = "center";
        signalCtx.fillText(timeValue.toFixed(0), x, plot.top + plot.height + 20);
    }
}

function renderSignalGraph() {
    const rect = signalCanvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
        return;
    }

    const width = rect.width;
    const height = rect.height;
    signalCtx.clearRect(0, 0, width, height);

    signalCtx.fillStyle = "rgba(255,255,255,0.025)";
    signalCtx.fillRect(0, 0, width, height);

    const plot = {
        left: 58,
        right: 18,
        top: 18,
        bottom: 38,
    };
    plot.width = width - plot.left - plot.right;
    plot.height = height - plot.top - plot.bottom;

    signalCtx.font = "12px Inter, Arial, sans-serif";

    const history = stateStore.signalHistory;
    if (history.length === 0) {
        signalCtx.fillStyle = "#9eb0c8";
        signalCtx.fillText("Waiting for signal data...", plot.left + 10, plot.top + 28);
        return;
    }

    const allTimes = history.map((sample) => sample.timeSeconds);
    const validSamples = history.filter((sample) => sample.rawDbm !== null);
    const minTime = Math.min(...allTimes);
    const maxTime = Math.max(minTime + 10, ...allTimes);

    if (validSamples.length === 0) {
        drawGraphGrid(plot, -140, -100, minTime, maxTime);
        signalCtx.strokeStyle = "rgba(255,255,255,0.22)";
        signalCtx.lineWidth = 1.3;
        signalCtx.beginPath();
        signalCtx.moveTo(plot.left, plot.top);
        signalCtx.lineTo(plot.left, plot.top + plot.height);
        signalCtx.lineTo(plot.left + plot.width, plot.top + plot.height);
        signalCtx.stroke();

        signalCtx.fillStyle = "#ff6b6b";
        signalCtx.textAlign = "left";
        signalCtx.fillText("No connected-signal samples yet.", plot.left + 10, plot.top + 28);
        return;
    }

    const values = validSamples.map((sample) => sample.rawDbm);
    let dataMin = Math.min(...values);
    let dataMax = Math.max(...values);
    const center = (dataMin + dataMax) / 2;
    const halfRange = Math.max(4.0, (dataMax - dataMin) / 2 + 3.0);
    dataMin = Math.floor(center - halfRange);
    dataMax = Math.ceil(center + halfRange);

    drawGraphGrid(plot, dataMin, dataMax, minTime, maxTime);

    signalCtx.strokeStyle = "rgba(255,255,255,0.22)";
    signalCtx.lineWidth = 1.3;
    signalCtx.beginPath();
    signalCtx.moveTo(plot.left, plot.top);
    signalCtx.lineTo(plot.left, plot.top + plot.height);
    signalCtx.lineTo(plot.left + plot.width, plot.top + plot.height);
    signalCtx.stroke();

    const toX = (timeValue) => plot.left + ((timeValue - minTime) / (maxTime - minTime || 1)) * plot.width;
    const toY = (signalValue) => plot.top + ((dataMax - signalValue) / (dataMax - dataMin || 1)) * plot.height;

    signalCtx.fillStyle = "#9eb0c8";
    signalCtx.textAlign = "center";
    signalCtx.fillText("Simulation time (s)", plot.left + plot.width / 2, height - 10);

    signalCtx.save();
    signalCtx.translate(16, plot.top + plot.height / 2);
    signalCtx.rotate(-Math.PI / 2);
    signalCtx.fillText("Strongest signal (dBm)", 0, 0);
    signalCtx.restore();

    signalCtx.save();
    signalCtx.beginPath();
    signalCtx.rect(plot.left, plot.top, plot.width, plot.height);
    signalCtx.clip();

    let currentSegment = [];
    const drawSegment = (segment) => {
        if (segment.length === 0) {
            return;
        }

        signalCtx.strokeStyle = "rgba(68, 214, 255, 0.96)";
        signalCtx.lineWidth = 2.25;
        signalCtx.beginPath();
        segment.forEach((sample, index) => {
            const x = toX(sample.timeSeconds);
            const y = toY(sample.rawDbm);
            if (index === 0) {
                signalCtx.moveTo(x, y);
            } else {
                signalCtx.lineTo(x, y);
            }
        });
        signalCtx.stroke();

        const last = segment[segment.length - 1];
        signalCtx.beginPath();
        signalCtx.arc(toX(last.timeSeconds), toY(last.rawDbm), 3.8, 0, Math.PI * 2);
        signalCtx.fillStyle = "#ffd66b";
        signalCtx.fill();
    };

    for (const sample of history) {
        if (sample.rawDbm === null) {
            drawSegment(currentSegment);
            currentSegment = [];
            continue;
        }
        currentSegment.push(sample);
    }
    drawSegment(currentSegment);

    signalCtx.restore();
}

async function deployFleet() {
    stateStore.pendingGroundStation = null;
    stateStore.inFlight = true;
    try {
        stateStore.simState = await postJson("/api/deploy", {
            num_sats: parseInt(satCountInput.value, 10),
            altitude_mode: randomAltitudeToggle.checked ? "random" : "fixed",
            fixed_altitude_km: Number(altitudeSlider.value),
        });
        syncSettingsFromState(stateStore.simState);
        buildOrbitLineCache(stateStore.simState);
        updateStats(stateStore.simState);
        recordSignalSample(stateStore.simState, true);
        setBaseStationControls(
            stateStore.simState.constants.ground_station.latitude_deg,
            stateStore.simState.constants.ground_station.longitude_deg,
        );
        stateStore.lastStepTs = performance.now();
        renderSignalGraph();
    } finally {
        stateStore.inFlight = false;
    }
}

async function processPendingGroundStation() {
    if (stateStore.inFlight || stateStore.pendingGroundStation === null) {
        return;
    }

    const payload = stateStore.pendingGroundStation;
    stateStore.pendingGroundStation = null;
    stateStore.inFlight = true;
    try {
        stateStore.simState = await postJson("/api/ground-station", payload);
        updateStats(stateStore.simState);
        recordSignalSample(stateStore.simState, false);
        setBaseStationControls(
            stateStore.simState.constants.ground_station.latitude_deg,
            stateStore.simState.constants.ground_station.longitude_deg,
        );
        renderSignalGraph();
    } catch (error) {
        console.error(error);
    } finally {
        stateStore.inFlight = false;
    }
}

async function stepSimulation(nowTs) {
    if (!stateStore.running || stateStore.inFlight || !stateStore.simState) {
        return;
    }

    const realDeltaSec = Math.min((nowTs - stateStore.lastStepTs) / 1000, 0.2);
    stateStore.lastStepTs = nowTs;
    const simDt = realDeltaSec * Number(physicsDtInput.value) * Number(simSpeedInput.value);

    if (simDt <= 0) {
        return;
    }

    stateStore.inFlight = true;
    try {
        stateStore.simState = await postJson("/api/step", { dt: simDt });
        updateStats(stateStore.simState);
        recordSignalSample(stateStore.simState, false);
        renderSignalGraph();
    } catch (error) {
        console.error(error);
    } finally {
        stateStore.inFlight = false;
    }
}

function animationFrame(nowTs) {
    processPendingGroundStation();
    stepSimulation(nowTs);
    render();
    if (document.getElementById("signalTab").classList.contains("active")) {
        renderSignalGraph();
    }
    requestAnimationFrame(animationFrame);
}

function setupPointerControls() {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    canvas.addEventListener("mousedown", (event) => {
        dragging = true;
        lastX = event.clientX;
        lastY = event.clientY;
    });

    window.addEventListener("mouseup", () => {
        dragging = false;
    });

    window.addEventListener("mousemove", (event) => {
        if (!dragging) {
            return;
        }
        const dx = event.clientX - lastX;
        const dy = event.clientY - lastY;
        lastX = event.clientX;
        lastY = event.clientY;

        stateStore.cameraYaw += dx * 0.005;
        stateStore.cameraPitch += dy * 0.005;
        stateStore.cameraPitch = clamp(stateStore.cameraPitch, -1.3, 1.3);
    });

    canvas.addEventListener("wheel", (event) => {
        event.preventDefault();
        const zoomDelta = event.deltaY > 0 ? 0.92 : 1.08;
        stateStore.zoom *= zoomDelta;
        stateStore.zoom = clamp(stateStore.zoom, 0.55, 2.7);
    }, { passive: false });
}

function loadImage(url) {
    return new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = url;
    });
}

async function loadFirstAvailable(urls) {
    for (const url of urls) {
        const image = await loadImage(url);
        if (image) {
            return image;
        }
    }
    return null;
}

async function loadTextures() {
    stateStore.textures.moon = await loadFirstAvailable([
        "/assets/moon_texture.jpg",
        "/assets/moon_texture.jpeg",
        "/assets/moon_texture.png",
        "/assets/moon.jpg",
        "/assets/moon.png",
    ]);

    stateStore.textures.earth = await loadFirstAvailable([
        "/assets/earth_texture.jpg",
        "/assets/earth_texture.jpeg",
        "/assets/earth_texture.png",
        "/assets/earth.jpg",
        "/assets/earth.png",
    ]);
}

function setupBaseStationControls() {
    stationLatitudeInput.addEventListener("input", () => {
        syncBaseStationInputs("lat-range");
        queueGroundStationUpdate();
    });
    stationLatitudeNumber.addEventListener("input", () => {
        if (syncBaseStationInputs("lat-number")) {
            queueGroundStationUpdate();
        }
    });
    stationLongitudeInput.addEventListener("input", () => {
        syncBaseStationInputs("lon-range");
        queueGroundStationUpdate();
    });
    stationLongitudeNumber.addEventListener("input", () => {
        if (syncBaseStationInputs("lon-number")) {
            queueGroundStationUpdate();
        }
    });

    stationLatitudeNumber.addEventListener("blur", () => {
        if (syncBaseStationInputs("lat-number")) {
            queueGroundStationUpdate();
        }
    });
    stationLongitudeNumber.addEventListener("blur", () => {
        if (syncBaseStationInputs("lon-number")) {
            queueGroundStationUpdate();
        }
    });
}

function setupTabs() {
    tabButtons.forEach((button) => {
        button.addEventListener("click", () => setActiveTab(button.dataset.tabTarget));
    });
}

async function initialize() {
    updateSliderLabels();
    resizeCanvas();
    resizeSignalCanvas();
    setupPointerControls();
    setupBaseStationControls();
    setupTabs();

    satCountInput.addEventListener("input", updateSliderLabels);
    altitudeSlider.addEventListener("input", updateSliderLabels);
    randomAltitudeToggle.addEventListener("change", updateSliderLabels);
    orbitLinesToggle.addEventListener("change", () => {
        stateStore.showOrbitLines = orbitLinesToggle.checked;
    });
    physicsDtInput.addEventListener("input", updateSliderLabels);
    simSpeedInput.addEventListener("input", updateSliderLabels);

    deployButton.addEventListener("click", () => deployFleet().catch(console.error));
    pauseButton.addEventListener("click", () => {
        stateStore.running = !stateStore.running;
        pauseButton.textContent = stateStore.running ? "Pause" : "Resume";
        stateStore.lastStepTs = performance.now();
    });

    window.addEventListener("resize", () => {
        resizeCanvas();
        resizeSignalCanvas();
        const rect = canvas.getBoundingClientRect();
        generateStars(rect.width, rect.height);
        renderSignalGraph();
    });

    await loadTextures();
    stateStore.simState = await getJson("/api/state");
    syncSettingsFromState(stateStore.simState);
    buildOrbitLineCache(stateStore.simState);
    updateStats(stateStore.simState);
    setBaseStationControls(
        stateStore.simState.constants.ground_station.latitude_deg,
        stateStore.simState.constants.ground_station.longitude_deg,
    );
    recordSignalSample(stateStore.simState, true);
    renderSignalGraph();
    requestAnimationFrame(animationFrame);
}

initialize().catch((error) => {
    console.error(error);
    signalTrackingStat.textContent = "Backend unreachable";
});