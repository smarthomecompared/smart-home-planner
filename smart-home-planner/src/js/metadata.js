// App metadata
var appRepoUrl = "https://github.com/smarthomecompared/smart-home-planner";
var supportedStores = [
    { id: "amazon_us", tag: "smart-home-planner-20", countryCodes: ["US"], continentCodes: ["AF", "AN", "AS", "NA", "OC", "SA"] },
    { id: "amazon_de", tag: "smart-home-planner-21", countryCodes: ["DE"], continentCodes: ["EU"] },
    { id: "amazon_uk", tag: "smart-home-planner-uk-21", countryCodes: ["GB"] },
    { id: "amazon_ca", tag: "smart-home-planner-ca-20", countryCodes: ["CA"] }
];

const DEFAULT_BRANDS = [
    'Aeotec', 'AirGradient', 'Airthings', 'Amazon', 'APC', 'Apollo Automation',
    'Apple', 'Aqara', 'Aranet', 'Arlo', 'Arre', 'Asus',
    'Beelink', 'Blink', 'Bosch', 'BroadLink', 'Centralite',
    'Ecobee', 'Eero', 'Eufy', 'Eve', 'Fibaro',
    'Gadnic', 'Geekom', 'Google', 'Govee Life', 'Heiman', 'HP', 'Huawei',
    'IKEA', 'iRobot', 'Kasa', 'Lenovo', 'LG',
    'Meross', 'Moes', 'Nanoleaf', 'Nabu Casa',
    'Netatmo', 'Nest', 'Nuki', 'Philips',
    'Raspberry Pi', 'Reolink', 'Ring', 'Roborock', 'Samsung', 'Sensi', 'Sensibo', 'Shelly',
    'Smlight', 'SmartThings', 'Sonoff', 'Sonos', 'SwitchBot',
    'Tapo', 'Third Reality', 'TP-Link', 'Tuya', 'Ubiquiti', 'UGREEN', 'Wyze',
    'X-Sense', 'Xiaomi', 'Yale', 'YoLink', 'Zooz'
];

const DEFAULT_TYPES = [
    'Access Points', 'Air Conditioners', 'Air Purifiers', 'Air Quality Monitors', 'Cameras', 'Curtain Controllers',
    'Dehumidifiers', 'Dimmer Switches', 'Displays', 'Dongles', 'Door Locks',
    'Door/Window Sensors', 'Doorbells', 'Energy Monitors', 'Fans', 'Garage Door Openers', 'Gate Controllers',
    'Heaters', 'Hubs', 'Humidifiers', 'IR Remote Controls', 'Keypads', 'LED Bulbs', 'Light Sensors', 'Light Strips',
    'Mini PCs', 'Mobile Phone', 'Modems / ONT', 'Motion Sensors', 'NAS', 'Network Switches', 'Notebook', 'Plugs', 'Power Strips', 'Presence Sensors', 'Printers',
    'Radiator Valves', 'Rain Sensors', 'Relays', 'Robot Vacuums', 'Routers', 'Sirens',
    'Smart Buttons', 'Smart TVs', 'Smoke & CO detectors', 'Smoke Alarms', 'Soil Moisture Sensors', 'Speakers', 'Streaming Devices',
    'Tablet', 'Temperature/Humidity Sensors', 'Thermostats', 'UPS', 'UV Sensors', 'Vibration Sensors', 'Voice Assistants',
    'Wall Outlets', 'Wall Switches', 'Washing Machine', 'Water Leak Sensors', 'Water Meters', 'Water Valves', 'Weather Stations',
    'Window Shades'
];

const DEFAULT_CONNECTIVITY = [
    'Bluetooth', 'Ethernet', 'Matter', 'Offline', 'Other', 'Wi-Fi', 'Z-Wave', 'Zigbee'
];

const DEFAULT_TEST_CASE_CATEGORIES = [
    'Security',
    'Safety',
    'Network',
    'Power',
    'Climate',
    'Access',
    'Irrigation'
];

const DEFAULT_BATTERY_TYPES = [
    {
        name: 'AA',
        amazonAsin: {
            amazon_us: 'B00O869KJE',
            amazon_ca: 'B00O869KJE',
            amazon_uk: 'B00O869KJE',
            amazon_de: 'B00O869KJE'
        }
    },
    {
        name: 'AAA',
        amazonAsin: {
            amazon_us: 'B00O869QUC',
            amazon_ca: 'B00O869QUC',
            amazon_uk: 'B00O869QUC',
            amazon_de: 'B00O869QUC'
        }
    },
    {
        name: 'CR123A',
        amazonAsin: {
            amazon_us: 'B07WTQHK27',
            amazon_ca: 'B004XWJHZU',
            amazon_uk: 'B004XWJHZU',
            amazon_de: 'B004XWJHZU'
        }
    },
    {
        name: 'CR17450',
        amazonAsin: {
            amazon_de: 'B00LW3ZID8'
        }
    },
    {
        name: 'CR2',
        amazonAsin: {
            amazon_us: 'B07JM6YZ2K',
            amazon_ca: 'B07JM6YZ2K',
            amazon_uk: 'B07JM6YZ2K',
            amazon_de: 'B07JM6YZ2K'
        }
    },
    {
        name: 'CR2016',
        amazonAsin: {
            amazon_us: 'B082BVK1WJ',
            amazon_ca: 'B082BVK1WJ',
            amazon_uk: 'B082BVK1WJ',
            amazon_de: 'B082BVK1WJ'
        }
    },
    {
        name: 'CR2025',
        amazonAsin: {
            amazon_us: 'B00L4EEQCY',
            amazon_ca: 'B00L4EEQCY',
            amazon_uk: 'B00L4EEQCY',
            amazon_de: 'B00L4EEQCY'
        }
    },
    {
        name: 'CR2032',
        amazonAsin: {
            amazon_us: 'B0787K2XWZ',
            amazon_ca: 'B0787K2XWZ',
            amazon_uk: 'B0787K2XWZ',
            amazon_de: 'B0787K2XWZ'
        }
    },
    {
        name: 'CR2430',
        amazonAsin: {
            amazon_us: 'B01418TEEE',
            amazon_ca: 'B01418TEEE',
            amazon_uk: 'B01418TEEE',
            amazon_de: 'B01418TEEE'
        }
    },
    {
        name: 'CR2450',
        amazonAsin: {
            amazon_us: 'B0047X1JLU',
            amazon_ca: 'B00KCH42V4',
            amazon_uk: 'B00KCH42V4',
            amazon_de: 'B00KCH42V4'
        }
    },
    {
        name: 'CR2477',
        amazonAsin: {
            amazon_us: 'B09VCS4Q3V',
            amazon_ca: 'B09VCS4Q3V',
            amazon_uk: 'B09VCS4Q3V',
            amazon_de: 'B09VCS4Q3V'
        }
    },
    {
        name: 'ER14250',
        amazonAsin: {
            amazon_us: 'B094D5LVSB',
            amazon_ca: 'B094D5LVSB',
            amazon_uk: 'B094D5LVSB',
            amazon_de: 'B094D5LVSB'
        }
    },
    {
        name: 'ER14335',
        amazonAsin: {
            amazon_us: 'B0FHJTT4F5',
            amazon_ca: 'B0FHJTT4F5',
            amazon_uk: 'B0D5YHHYSQ',
            amazon_de: 'B01DL43EJ0'
        }
    },
    {
        name: 'ER18505',
        amazonAsin: {
            amazon_ca: 'B07TYKKFNV',
            amazon_uk: 'B0BNNKXG2K'
        }
    },
    { name: 'Internal', amazonAsin: null },
    { name: 'USB', amazonAsin: null }
];
