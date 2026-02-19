// App metadata
var appRepoUrl = "https://github.com/smarthomecompared/smart-home-planner";

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
    'Access Points', 'Air Conditioners', 'Air Purifiers', 'Air Quality Monitors', 'Cameras', 'Curtain Controllers',
    'Dehumidifiers', 'Dimmer Switches', 'Displays', 'Dongles', 'Door Locks',
    'Door/Window Sensors', 'Doorbells', 'Energy Monitors', 'Fans', 'Garage Door Openers', 'Gate Controllers',
    'Heaters', 'Hubs', 'Humidifiers', 'IR Remote Controls', 'Keypads', 'LED Bulbs', 'Light Sensors', 'Light Strips',
    'Mini PCs', 'Motion Sensors', 'NAS', 'Network Switches', 'Plugs', 'Presence Sensors',
    'Radiator Valves', 'Rain Sensors', 'Relays', 'Robot Vacuums', 'Routers', 'Sirens',
    'Smart Buttons', 'Smart TVs', 'Smoke & CO detectors', 'Soil Moisture Sensors', 'Speakers', 'Streaming Devices',
    'Temperature/Humidity Sensors', 'Thermostats', 'UV Sensors', 'Vibration Sensors', 'Voice Assistants',
    'Wall Outlets', 'Wall Switches', 'Water Leak Sensors', 'Water Meters', 'Water Valves', 'Weather Stations',
    'Window Shades'
];

const DEFAULT_CONNECTIVITY = [
    'Bluetooth', 'Matter', 'Offline','Wi-Fi', 'Z-Wave', 'Zigbee'
];

const DEFAULT_BATTERY_TYPES = [
    'AA', 'AAA', 'CR123A', 'CR17450', 'CR2032', 'CR2477', 'Internal', 'USB'
];
