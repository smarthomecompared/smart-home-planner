# Smart Home Planner (Home Assistant App)

Home Assistant App to plan, document, and visualize your smart home ecosystem. All data is stored in the app `/data` volume (so it is included in Home Assistant backups) and the UI includes dashboards, advanced filters, and a device connection map. The app is served via Home Assistant **ingress** for a clean, built-in experience.

## Features
- A quick dashboard that highlights what matters most in your smart home.
- Easy device list with search, filters, and a clear status overview.
- Simple forms to keep device details, notes, and dates in one place.
- Organize everything by floors and areas.
- Visual map to see how devices are connected.
- Support for multiple homes.
- Backup and restore your data from Settings.

## Installation

* Go to the **App Store**, click **⋮ → Repositories**, fill in</br> `https://github.com/smarthomecompared/smart-home-planner` and click **Add → Close** or click the **Add repository** button below, click **Add → Close** (You might need to enter the **internal IP address** of your Home Assistant instance first).

[![Open your Home Assistant instance and show the add app repository dialog with a specific repository URL pre-filled.](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fsmarthomecompared%2Fsmart-home-planner)

* Click on the Smart Home Planner App and press **Install** and wait till the app is installed.
* Start the app by going to **Info** and click **Start**
* Wait a few seconds and press **OPEN WEB UI**, you will now see the onboarding page.

## Deploy for Testing in Home Assistant

Use this deploy flow to push local changes to a Home Assistant **testing** instance.

1. From the repository root, run:

```bash
sh sync-samba.sh
```

2. The script copies `smart-home-planner/` to the mounted add-ons folder (`/Volumes/addons`).
3. Restart the app in Home Assistant to load the updated files.

![Supports aarch64 Architecture][aarch64-shield]
![Supports amd64 Architecture][amd64-shield]
![Supports armhf Architecture][armhf-shield]
![Supports armv7 Architecture][armv7-shield]
![Supports i386 Architecture][i386-shield]

[aarch64-shield]: https://img.shields.io/badge/aarch64-yes-green.svg
[amd64-shield]: https://img.shields.io/badge/amd64-yes-green.svg
[armhf-shield]: https://img.shields.io/badge/armhf-yes-green.svg
[armv7-shield]: https://img.shields.io/badge/armv7-yes-green.svg
[i386-shield]: https://img.shields.io/badge/i386-yes-green.svg
