// App metadata
var appVersion = "0.1.0"
var appReleaseDate = "2026-02-03"
var appReleaseNotes = [
    "A quick dashboard that highlights what matters most in your smart home.",
    "Easy device list with search, filters, and a clear status overview.",
    "Simple forms to keep device details, notes, and dates in one place.",
    "Organize everything by floors and areas.",
    "Visual map to see how devices are connected.",
    "Support for multiple homes.",
    "Backup and restore your data from Settings."
];

const DEFAULT_HOME_NAME = 'Default';

const DEFAULT_SETTINGS = {
    brands: [
        'Aqara', 'Apple', 'Broadlink', 'Echo', 'Ecobee', 'Eufy', 'Google',
        'Home Assistant', 'Hue', 'Insteon', 'Lutron', 'Meross', 'Nest',
        'Philips', 'Ring', 'Shelly', 'Sonoff', 'SwitchBot', 'TP-Link',
        'Tuya', 'Wyze', 'Xiaomi', 'Yale', 'Zigbee', 'Z-Wave'
    ],
    types: [
        'air-quality-monitors', 'cameras', 'displays', 'dongles', 'door-locks',
        'door-window-sensors', 'doorbells', 'hubs', 'ir-remote-controls',
        'led-bulbs', 'mini-pcs', 'motion-sensors', 'plugs', 'presence-sensors',
        'radiator-valves', 'relays', 'robot-vacuums', 'routers', 'sirens',
        'smoke-alarms', 'speakers', 'temperature-humidity-sensors', 'thermostats',
        'vibration-sensors', 'voice-assistants', 'wall-outlets', 'wall-switches',
        'water-leak-sensors', 'water-valves'
    ],
    connectivity: [
        'wifi', 'zigbee', 'z-wave', 'bluetooth', 'matter'
    ],
    batteryTypes: [
        'USB', 'CR2477', 'AA', 'AAA'
    ]
};
