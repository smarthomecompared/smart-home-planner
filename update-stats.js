// update-stats.js
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import fetch from "node-fetch";

const SLUG = "1750ef26_smart-home-planner";
const REPO_API_URL = "https://api.github.com/repos/smarthomecompared/smart-home-planner";
const REPO_RELEASE_API_URL = `${REPO_API_URL}/releases/latest`;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_FILE = path.join(SCRIPT_DIR, "docs", "history.json");
const MAX_HISTORY_DAYS = 3650;

function getDateKey(value) {
    return new Date(value).toISOString().slice(0, 10);
}

function normalizeEntry(entry) {
    const dateKey = getDateKey(entry.date);

    return {
        date: dateKey,
        total: entry.total || 0,
        auto_update: entry.auto_update || 0,
        install_rank: Number.isInteger(entry.install_rank) ? entry.install_rank : null,
        total_rank: Number.isInteger(entry.total_rank) ? entry.total_rank : null,
        stars: Number.isFinite(entry.stars) ? entry.stars : null,
        versions: entry.versions || {}
    };
}

function getInstallRank(allAddons, targetSlug) {
    const targetAddon = allAddons[targetSlug];
    if (!targetAddon || !Number.isFinite(targetAddon.total)) {
        return null;
    }

    const higherInstallCount = Object.entries(allAddons).reduce((count, [slug, addon]) => {
        if (slug === targetSlug || !Number.isFinite(addon?.total)) {
            return count;
        }

        return addon.total > targetAddon.total ? count + 1 : count;
    }, 0);

    return higherInstallCount + 1;
}

function getTotalRank(allAddons) {
    return Object.values(allAddons).reduce((count, addon) => {
        return Number.isFinite(addon?.total) ? count + 1 : count;
    }, 0);
}

function normalizeHistory(history) {
    const entriesByDay = new Map();

    for (const rawEntry of Array.isArray(history) ? history : []) {
        const entry = normalizeEntry(rawEntry);
        entriesByDay.set(entry.date, entry);
    }

    return Array.from(entriesByDay.values())
        .sort((left, right) => left.date.localeCompare(right.date))
        .slice(-MAX_HISTORY_DAYS);
}

function parseStoredPayload(payload) {
    if (Array.isArray(payload)) {
        return {
            history: payload,
            latestRelease: null
        };
    }

    if (payload && typeof payload === "object") {
        const history = Array.isArray(payload.history) ? payload.history : [];
        const latestRelease = typeof payload?.meta?.latest_release === "string"
            ? payload.meta.latest_release
            : null;

        return {
            history,
            latestRelease
        };
    }

    return {
        history: [],
        latestRelease: null
    };
}

async function updateHistory() {
    try {
        const [analyticsResponse, repoResponse, releaseResponse] = await Promise.all([
            fetch("https://analytics.home-assistant.io/addons.json"),
            fetch(REPO_API_URL, {
                headers: {
                    "Accept": "application/vnd.github+json",
                    "User-Agent": "stats-tracker"
                }
            }),
            fetch(REPO_RELEASE_API_URL, {
                headers: {
                    "Accept": "application/vnd.github+json",
                    "User-Agent": "stats-tracker"
                }
            })
        ]);

        const allAddons = await analyticsResponse.json();
        const addon = allAddons[SLUG];
        const repo = repoResponse.ok ? await repoResponse.json() : null;
        const release = releaseResponse.ok ? await releaseResponse.json() : null;

        if (!addon) {
            console.error("❌ Add-on not found in analytics.home-assistant.io");
            return;
        }

        const installRank = getInstallRank(allAddons, SLUG);
        const totalRank = getTotalRank(allAddons);
        const now = new Date();
        const latestRelease = typeof release?.tag_name === "string" ? release.tag_name : null;
        const entry = {
            date: getDateKey(now),
            total: addon.total,
            auto_update: addon.auto_update || 0,
            install_rank: installRank,
            total_rank: totalRank,
            stars: Number.isFinite(repo?.stargazers_count) ? repo.stargazers_count : null,
            versions: addon.versions || {}
        };

        let history = [];
        let storedLatestRelease = null;
        try {
            const data = await fs.readFile(HISTORY_FILE, "utf8");
            const payload = parseStoredPayload(JSON.parse(data));
            history = payload.history;
            storedLatestRelease = payload.latestRelease;
        } catch (error) {
            console.log("📂 Creating new history file...");
        }

        const normalizedHistory = normalizeHistory(history);
        const existingIndex = normalizedHistory.findIndex((item) => item.date === entry.date);

        if (existingIndex >= 0) {
            normalizedHistory[existingIndex] = entry;
        } else {
            normalizedHistory.push(entry);
        }

        const finalHistory = normalizedHistory
            .sort((left, right) => left.date.localeCompare(right.date))
            .slice(-MAX_HISTORY_DAYS);

        const finalLatestRelease = latestRelease || storedLatestRelease;
        const finalPayload = {
            meta: {
                latest_release: finalLatestRelease
            },
            history: finalHistory
        };

        await fs.writeFile(HISTORY_FILE, JSON.stringify(finalPayload, null, 2));

        console.log(`✅ Saved ${entry.date}. Total installations: ${addon.total}. Rank: ${entry.install_rank ?? "n/a"}/${entry.total_rank ?? "n/a"}. GitHub stars: ${entry.stars ?? "n/a"}. Latest release: ${finalLatestRelease ?? "n/a"}`);
    } catch (error) {
        console.error("❌ Error:", error.message);
    }
}

updateHistory();
