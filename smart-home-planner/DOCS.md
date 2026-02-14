# Smart Home Planner - Documentation

**Smart Home Planner** is a lightweight add-on that lets you plan, document, and visualize your smart home ecosystem directly from Home Assistant.

It provides a clean, static web interface to:
- Create a quick dashboard highlighting key aspects of your setup.
- Maintain an easy-to-search device list with filters and status overviews.
- Add detailed notes, specifications, purchase dates, and maintenance reminders for each device.
- Organize devices by floors, rooms, or areas.
- View a visual map of device connections and dependencies.
- Support multiple homes or locations.
- Backup and restore your planning data from the add-on's settings.

This app serves the UI and a small storage API via a built-in Python server, keeping everything fast, secure, and fully integrated with Home Assistant via **ingress**. All app data is stored in the app `/data` volume so Home Assistant backups include it.
