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

var appRepoUrl = "https://github.com/smarthomecompared/smart-home-planner";

const DEFAULT_HOME_NAME = 'Default';

const DEFAULT_BRANDS = [
    'Aeotec', 'AirGradient', 'Airthings', 'Amazon', 'Apollo Automation',
    'Apple', 'Aqara', 'Aranet', 'Arlo', 'Arre', 'Asus', 'August',
    'Beelink', 'Belkin', 'Blink', 'Bosch', 'BroadLink', 'Centralite',
    'Cync', 'Ecovacs', 'Ecobee', 'Eero', 'Eufy', 'Eve', 'Fibaro', 'GE',
    'Geekom', 'Google', 'Govee Life', 'Heiman', 'Honeywell Home',
    'Hubitat', 'IKEA', 'Insteon', 'IQAir', 'iRobot', 'Kasa', 'Kwikset',
    'Leviton', 'LIFX', 'Lutron', 'Meross', 'Moes', 'Nanoleaf', 'Nabu Casa',
    'Netatmo', 'Nest', 'Nuki', 'Philips', 'Philips Hue', 'Rachio',
    'Reolink', 'Ring', 'Roborock', 'Schlage', 'Sensi', 'Shelly',
    'SimpliSafe', 'Smlight', 'SmartThings', 'Sonoff', 'Sonos', 'SwitchBot',
    'Tapo', 'Third Reality', 'TP-Link', 'Tuya', 'Ubiquiti', 'Wyze',
    'X-Sense', 'Xiaomi', 'Yale', 'YoLink', 'Zooz'
];

const DEFAULT_TYPES = [
    'Air Purifiers', 'Air Quality Monitors', 'Cameras', 'Curtain Controllers', 'Displays', 'Dongles', 'Door Locks',
    'Door/Window Sensors', 'Doorbells', 'Hubs', 'IR Remote Controls',
    'LED Bulbs', 'Mini PCs', 'Motion Sensors', 'Plugs', 'Presence Sensors',
    'Radiator Valves', 'Relays', 'Robot Vacuums', 'Routers', 'Sirens',
    'Smoke Alarms', 'Speakers', 'Streaming Devices', 'Temperature/Humidity Sensors', 'Thermostats',
    'Vibration Sensors', 'Voice Assistants', 'Wall Outlets', 'Wall Switches',
    'Water Leak Sensors', 'Water Valves'
];

const DEFAULT_CONNECTIVITY = [
    'Bluetooth', 'Matter', 'Wi-Fi', 'Z-Wave', 'Zigbee'
];

const DEFAULT_BATTERY_TYPES = [
    'AA', 'AAA', 'CR123A', 'CR17450', 'CR2032', 'CR2477', 'Internal', 'USB'
];
