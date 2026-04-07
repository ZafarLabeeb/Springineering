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
    maxHistoryPoints: 500,
    pendingGroundStation: null,
    groundStationDebounceId: null,
};

const canvas = document.getElementById("simCanvas");
const ctx = canvas.getContext("2d");
const signalCanvas = document.getElementById("signalCanvas");
const signalCtx = signalCanvas.getContext("2d");

const satCountInput = document.getElementById("satCount");
const physicsDtInput = document.getElementById("physicsDt");
const simSpeedInput = document.getElementById("simSpeed");
const stationLatitudeInput = document.getElementById("stationLatitude");
const stationLatitudeNumber = document.getElementById("stationLatitudeNumber");
const stationLongitudeInput = document.getElementById("stationLongitude");
const stationLongitudeNumber = document.getElementById("stationLongitudeNumber");

const deployButton = document.getElementById("deployButton");
const pauseButton = document.getElementById("pauseButton");

const satCountValue = document.getElementById("satCountValue");
const physicsDtValue = document.getElementById("physicsDtValue");
const simSpeedValue = document.getElementById("simSpeedValue");

const connectedStat = document.getElementById("connectedStat");
const signalStat = document.getElementById("signalStat");
const trackingStat = document.getElementById("trackingStat");
const timeStat = document.getElementById("timeStat");
const baseStationStat = document.getElementById("baseStationStat");
const baseStatusStat = document.getElementById("baseStatusStat");
const distanceStat = document.getElementById("distanceStat");

const connectionBadge = document.getElementById("connectionBadge");
const signalGraphLatest = document.getElementById("signalGraphLatest");
const signalAbsStat = document.getElementById("signalAbsStat");
const signalTrackingStat = document.getElementById("signalTrackingStat");
const sampleCountStat = document.getElementById("sampleCountStat");

const tabButtons = Array.from(document.querySelectorAll(".tab-btn"));
const tabPanels = Array.from(document.querySelectorAll(".tab-panel"));

function clamp(value, minValue, maxValue) {
    return Math.max(minValue, Math.min(maxValue, value));
}

function wrapLongitude(value) {
    let wrapped = Number(value);
    while (wrapped > 180) wrapped -= 360;
    while (wrapped < -180) wrapped += 360;
    return wrapped;
}

function updateSliderLabels() {
    satCountValue.textContent = String(satCountInput.value);
    physicsDtValue.textContent = `${Number(physicsDtInput.value).toFixed(1)} s`;
    simSpeedValue.textContent = `${parseInt(simSpeedInput.value, 10)}x`;
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
        const value = clamp(Number(stationLatitudeNumber.value || 0), -90, 90);
        stationLatitudeNumber.value = Number.isFinite(value) ? value.toFixed(1) : "0.0";
        stationLatitudeInput.value = String(Math.round(value));
    } else if (source === "lon-range") {
        stationLongitudeNumber.value = Number(stationLongitudeInput.value).toFixed(1);
    } else if (source === "lon-number") {
        const rawValue = Number(stationLongitudeNumber.value || 0);
        const value = Number.isFinite(rawValue) ? wrapLongitude(rawValue) : 0;
        stationLongitudeNumber.value = value.toFixed(1);
        stationLongitudeInput.value = String(Math.round(value));
    }
}

function scheduleGroundStationUpdate() {
    const latitudeDeg = clamp(Number(stationLatitudeNumber.value), -90, 90);
    const longitudeDeg = wrapLongitude(Number(stationLongitudeNumber.value));

    stateStore.pendingGroundStation = {
        latitude_deg: latitudeDeg,
        longitude_deg: longitudeDeg,
    };

    if (stateStore.groundStationDebounceId !== null) {
        window.clearTimeout(stateStore.groundStationDebounceId);
    }

    stateStore.groundStationDebounceId = window.setTimeout(() => {
        stateStore.groundStationDebounceId = null;
    }, 120);
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
        absDbm: state.best_signal_dbm === null ? null : Math.abs(Number(state.best_signal_dbm)),
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

    sampleCountStat.textContent = String(history.length);
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

    const connected = state.connection_status === "Connected";
    connectionBadge.textContent = connected ? "Connected" : "No connection";
    connectionBadge.classList.toggle("connected", connected);
    connectionBadge.classList.toggle("disconnected", !connected);

    signalGraphLatest.textContent = state.best_signal_dbm === null
        ? "No connection"
        : `${state.best_signal_dbm.toFixed(2)} dBm`;
    signalAbsStat.textContent = state.best_signal_dbm === null
        ? "--"
        : Math.abs(state.best_signal_dbm).toFixed(2);
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

function projectPoint(point, modelScale, width, height) {
    const rotated = rotatePoint(point);
    const cx = width / 2;
    const cy = height / 2;
    const cameraDistance = 8.0e6 / stateStore.zoom;
    const depth = cameraDistance - rotated.z;
    const safeDepth = Math.max(depth, 1.0e5);
    const perspective = cameraDistance / safeDepth;

    return {
        x: cx + rotated.x * modelScale * perspective,
        y: cy - rotated.y * modelScale * perspective,
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

function drawEarthBackdrop(width, height, moonRadiusPx, simTimeSeconds) {
    const x = width * 0.77 + Math.sin(stateStore.cameraYaw * 0.8) * width * 0.045;
    const y = height * 0.24 + stateStore.cameraPitch * height * 0.05;
    const radiusPx = moonRadiusPx * 0.54;
    const earthTextureOffset = simTimeSeconds / 12000;

    drawTexturedBody(x, y, radiusPx, stateStore.textures.earth, {
        textureOffset: earthTextureOffset,
        fallbackColors: [[0, "#d1ecff"], [0.3, "#5fa8ff"], [0.72, "#27627d"], [1, "#102030"]],
        rimColor: "rgba(170,220,255,0.24)",
        glowColor: "rgba(82, 196, 255, 0.24)",
    });
}

function drawGroundStationMarker(projected, connected) {
    const radius = 7;
    ctx.save();
    ctx.translate(projected.x, projected.y);

    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fillStyle = connected ? "#67f2ff" : "#44d6ff";
    ctx.shadowBlur = 16;
    ctx.shadowColor = "rgba(68, 214, 255, 0.75)";
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(180, 245, 255, 0.95)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -12);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, -14, 5.4, Math.PI * 0.14, Math.PI * 0.86);
    ctx.stroke();
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
    const radius = Math.max(2.2, 3.6 * projected.perspective);
    ctx.beginPath();
    ctx.arc(projected.x, projected.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = sat.is_visible ? "#69f0a8" : "#ff6b6b";
    ctx.shadowBlur = 10;
    ctx.shadowColor = ctx.fillStyle;
    ctx.fill();
    ctx.shadowBlur = 0;
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
    const modelScale = (Math.min(width, height) * 0.18) / moonRadiusM;
    const moonScreenRadius = moonRadiusM * modelScale;
    const centerX = width / 2;
    const centerY = height / 2;

    drawEarthBackdrop(width, height, moonScreenRadius, state.time_seconds);

    const moonTextureOffset = stateStore.cameraYaw / (Math.PI * 2);
    drawTexturedBody(centerX, centerY, moonScreenRadius, stateStore.textures.moon, {
        textureOffset: moonTextureOffset,
        fallbackColors: [[0, "#d8dee8"], [0.35, "#adb7c6"], [1, "#495566"]],
        rimColor: "rgba(255,255,255,0.12)",
    });

    const projectedGround = projectPoint(state.constants.ground_station, modelScale, width, height);
    const groundOnFront = projectedGround.z > 0;

    const projectedSats = state.satellites.map((sat) => {
        const point = {
            x: sat.position_m.x,
            y: sat.position_m.y,
            z: sat.position_m.z,
        };
        const projected = projectPoint(point, modelScale, width, height);
        const dx = projected.x - centerX;
        const dy = projected.y - centerY;
        const insideMoonDisk = Math.hypot(dx, dy) < moonScreenRadius * 0.975;
        const hiddenBehindMoon = insideMoonDisk && projected.z < 0;
        return { sat, projected, hiddenBehindMoon };
    });

    projectedSats.sort((a, b) => a.projected.z - b.projected.z);

    if (groundOnFront) {
        drawGroundStationMarker(projectedGround, state.connection_status === "Connected");
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

function drawGraphGrid(width, height, plot) {
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
    }

    for (let i = 0; i <= verticalLines; i += 1) {
        const x = plot.left + (plot.width * i) / verticalLines;
        signalCtx.beginPath();
        signalCtx.moveTo(x, plot.top);
        signalCtx.lineTo(x, plot.top + plot.height);
        signalCtx.stroke();
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
        left: 52,
        right: 18,
        top: 18,
        bottom: 36,
    };
    plot.width = width - plot.left - plot.right;
    plot.height = height - plot.top - plot.bottom;

    drawGraphGrid(width, height, plot);

    signalCtx.strokeStyle = "rgba(255,255,255,0.22)";
    signalCtx.lineWidth = 1.3;
    signalCtx.beginPath();
    signalCtx.moveTo(plot.left, plot.top);
    signalCtx.lineTo(plot.left, plot.top + plot.height);
    signalCtx.lineTo(plot.left + plot.width, plot.top + plot.height);
    signalCtx.stroke();

    const history = stateStore.signalHistory;
    if (history.length === 0) {
        signalCtx.fillStyle = "#9eb0c8";
        signalCtx.font = "14px Inter, Arial, sans-serif";
        signalCtx.fillText("Waiting for signal data...", plot.left + 10, plot.top + 28);
        return;
    }

    const allTimes = history.map((sample) => sample.timeSeconds);
    const validSamples = history.filter((sample) => sample.absDbm !== null);
    const minTime = Math.min(...allTimes);
    const maxTime = Math.max(minTime + 10, ...allTimes);
    const maxAbs = validSamples.length > 0 ? Math.max(20, ...validSamples.map((sample) => sample.absDbm)) : 20;
    const yMax = Math.ceil(maxAbs * 1.12);

    const toX = (timeValue) => plot.left + ((timeValue - minTime) / (maxTime - minTime || 1)) * plot.width;
    const toY = (absDbmValue) => plot.top + plot.height - (absDbmValue / yMax) * plot.height;

    signalCtx.font = "12px Inter, Arial, sans-serif";
    signalCtx.fillStyle = "#9eb0c8";
    signalCtx.textAlign = "center";
    signalCtx.fillText("Simulation time (s)", plot.left + plot.width / 2, height - 10);

    signalCtx.save();
    signalCtx.translate(16, plot.top + plot.height / 2);
    signalCtx.rotate(-Math.PI / 2);
    signalCtx.fillText("Absolute signal |dBm|", 0, 0);
    signalCtx.restore();

    signalCtx.textAlign = "right";
    signalCtx.fillText("0", plot.left - 8, plot.top + plot.height + 4);
    signalCtx.fillText(String(yMax), plot.left - 8, plot.top + 4);
    signalCtx.textAlign = "center";
    signalCtx.fillText(minTime.toFixed(0), plot.left, plot.top + plot.height + 20);
    signalCtx.fillText(maxTime.toFixed(0), plot.left + plot.width, plot.top + plot.height + 20);

    if (validSamples.length === 0) {
        signalCtx.fillStyle = "#ff6b6b";
        signalCtx.textAlign = "left";
        signalCtx.fillText("No connected-signal samples yet.", plot.left + 10, plot.top + 28);
        return;
    }

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
            const y = toY(sample.absDbm);
            if (index === 0) {
                signalCtx.moveTo(x, y);
            } else {
                signalCtx.lineTo(x, y);
            }
        });
        signalCtx.stroke();

        const last = segment[segment.length - 1];
        const lx = toX(last.timeSeconds);
        const ly = toY(last.absDbm);
        signalCtx.beginPath();
        signalCtx.arc(lx, ly, 3.8, 0, Math.PI * 2);
        signalCtx.fillStyle = "#ffd66b";
        signalCtx.fill();
    };

    for (const sample of history) {
        if (sample.absDbm === null) {
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
    stateStore.inFlight = true;
    try {
        stateStore.simState = await postJson("/api/deploy", {
            num_sats: parseInt(satCountInput.value, 10),
        });
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
    if (stateStore.inFlight || stateStore.pendingGroundStation === null || stateStore.groundStationDebounceId !== null) {
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
        stateStore.zoom = clamp(stateStore.zoom, 0.5, 2.8);
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
        scheduleGroundStationUpdate();
    });
    stationLatitudeNumber.addEventListener("input", () => {
        syncBaseStationInputs("lat-number");
        scheduleGroundStationUpdate();
    });
    stationLongitudeInput.addEventListener("input", () => {
        syncBaseStationInputs("lon-range");
        scheduleGroundStationUpdate();
    });
    stationLongitudeNumber.addEventListener("input", () => {
        syncBaseStationInputs("lon-number");
        scheduleGroundStationUpdate();
    });

    stationLatitudeNumber.addEventListener("blur", () => {
        syncBaseStationInputs("lat-number");
        scheduleGroundStationUpdate();
    });
    stationLongitudeNumber.addEventListener("blur", () => {
        syncBaseStationInputs("lon-number");
        scheduleGroundStationUpdate();
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
    connectionBadge.textContent = "Backend unreachable";
    connectionBadge.classList.remove("connected");
    connectionBadge.classList.add("disconnected");
    signalGraphLatest.textContent = "Backend unreachable";
});