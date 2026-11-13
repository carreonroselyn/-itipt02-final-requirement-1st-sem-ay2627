# PawRescue

PawRescue is an Ionic Angular app backed by a FastAPI REST API and a MySQL database running in XAMPP. Users, admins, animal reports, adoption applications, and API sessions are saved in MySQL database `petrescue_db`.

## 1. Set up the database

1. Start **MySQL** in the XAMPP Control Panel.
2. Open `http://localhost/phpmyadmin`.
3. Select **Import**, choose `backend\petrescue_db.sql`, then select **Import**. This creates `petrescue_db` and the `users`, `auth_tokens`, `animals`, `rescue_report_history`, and `adoptions` tables. Re-import the SQL file on an existing installation to create the report history table.
4. The default local XAMPP credentials are `root` with an empty password. If yours differ, set the `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASS` environment variables before starting the API. `.env.example` lists the expected values; Python does not load it automatically.

The `users` table stores both adopter and admin accounts; the `role` column distinguishes `user` from `admin`. There is deliberately no built-in admin password. Register an account through the app, then grant that account admin access in phpMyAdmin:

```sql
UPDATE users SET role = 'admin' WHERE email = 'your-admin@email.com';
```

Sign out and sign back in to load the updated role.

## 2. Start the FastAPI backend

Run these commands from the project root in PowerShell:

```powershell
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

`main.py` is the ASGI module used by `uvicorn main:app`. Check `http://127.0.0.1:8000/health` for the database connection status and `http://127.0.0.1:8000/docs` for the API docs. If the database is unavailable, the API reports a clear MySQL/XAMPP error rather than pretending data was saved.

## 3. Start the Ionic app

In a second PowerShell window:

```powershell
npm install
npm start
```

Open the address printed by Ionic. The app is configured to call `http://127.0.0.1:8000/`.

## Persisted app flows

- **Authentication:** Registration creates a `users` row with a hashed password and default `user` role. Login returns a bearer token whose hash and expiry are stored in `auth_tokens`.
- **Rescue reporting:** Each authenticated user's reports are saved in `animals` with `Pending Rescue` status, location, notes, and optional uploaded photo. Submissions and every rescue-status change are recorded in `rescue_report_history` and shown on the client and admin dashboards.
- **Rescue team dashboard:** Admins can transition animal status, add medical notes, and update name, age, or gender. The API checks admin role and valid workflow transitions.
- **Animal reports:** The animal feed and dashboards use Angular Signals for reactive data binding. Reports support create, read, update, and admin-only delete through the REST API; reports with adoption history are protected from deletion.
- **Adoptions:** Each logged-in adopter's application is saved in `adoptions`. Approving a request reserves the animal and declines other pending requests for it.
- **Public feed:** The API returns healed-and-ready animals publicly. A signed-in user can also see their own reports; admins can see all reports. The app polls the database every 30 seconds.
- **Photos:** API uploads are written to `backend\uploads`; only validated JPEG, PNG, and WebP files up to 2.5 MB are accepted.

Without a logged-in database account, the **User view** and **Admin view** preview buttons remain demo-only and save to browser local storage. To persist data, create/sign in to a database account; use SQL above for an admin.

## Notes

- Native camera and geolocation use `@capacitor/camera` and `@capacitor/geolocation`; run `npx cap sync` after installing the plugins for native builds.
- Browser geolocation requires permission and a secure context; `localhost` is allowed.
- The API allows the local Ionic development origins. Configure an explicit trusted CORS origin before deployment.
