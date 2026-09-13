# Connecting Real Data

Myaku reads body data four ways. Two work with no setup at all; two need developer
credentials from the provider, because only the provider can issue them.

| Source | Works Today | Setup | Heart Rate Variability Statistic |
|---|---|---|---|
| Manual entry | Yes | None | Whatever you type |
| Spreadsheet (CSV) | Yes | None | Whatever the file holds |
| Apple Health export | Yes | None | SDNN |
| Whoop | After setup | Developer app | RMSSD |
| Google Health (Fitbit Air, Fitbit, Pixel Watch) | After setup | Google Cloud project | RMSSD |

**Do not mix heart rate variability sources on one account.** Apple Watch reports SDNN;
Whoop and Google report RMSSD. They are different statistics with different typical
values, and Myaku compares every reading against your own history, so switching sources
mid-season makes it look as though your HRV changed when only the measuring did.

---

## Google Health (Fitbit Air)

The legacy Fitbit Web API is decommissioned on **September 30, 2026**, and its tokens do not
transfer. The Fitbit Air pairs with the Google Health app, so Myaku reads it through the
**Google Health API**.

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com).
2. Enable the **Google Health API** for the project.
3. Configure the **OAuth consent screen**. Leave the publishing status on **Testing** and add
   your own Google account under **Test users**.
4. Add these scopes:
   - `https://www.googleapis.com/auth/googlehealth.sleep.readonly`
   - `https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly`
5. Create an **OAuth client ID** of type **Web application**, with this authorised redirect URI:
   `<your public origin>/api/integrations/google/callback`
6. Put the client ID and secret in `.env` as `GOOGLE_HEALTH_CLIENT_ID` and
   `GOOGLE_HEALTH_CLIENT_SECRET`, then restart the server.

The Google Health scopes are classified as restricted. Test users can use them while the app
is in Testing; opening the app to the public requires Google's security review first.

> **Not yet verified against a live account.** The field names Myaku reads (`minutesAsleep`,
> `minutesInBed`, `efficiency`, `beatsPerMinute`, `rmssd`) come from Google's documentation,
> but the exact nesting of each response was not available to test against. The parser looks
> each field up by name rather than by fixed path to tolerate that. After your first sync,
> check that **Sources** shows a sensible number of days, and compare one night against the
> Google Health app.

## Whoop

Myaku uses Whoop's v2 API. Version 1 was removed after October 1, 2025.

1. Sign in at [developer.whoop.com](https://developer.whoop.com) and create an app.
2. Request the scopes `read:recovery`, `read:sleep`, `read:cycles`, `read:profile`, and `offline`.
   The `offline` scope is what returns a refresh token; without it the connection lapses
   within an hour.
3. Register the redirect URI `<your public origin>/api/integrations/whoop/callback`.
4. Put the client ID and secret in `.env` as `WHOOP_CLIENT_ID` and `WHOOP_CLIENT_SECRET`.

## Apple Health Export

HealthKit only exists on the iPhone, so no web server can read it directly; the native iOS
app will. Until then:

1. On the iPhone, open **Health**, tap your profile picture, then **Export All Health Data**.
2. Save or AirDrop the archive to a computer and **unzip it**.
3. In Myaku, open **More**, then **Data Sources**, and choose `export.xml` from the unzipped folder.

The file is read as a stream, so a large export is fine, and only heart rate variability,
resting heart rate, and sleep records are kept.

## Spreadsheet

A CSV with a header row. Only `date` is required; any column can be left blank.

```csv
date,hrv,rhr,sleep_minutes,sleep_efficiency
2026-09-01,64,52,441,91
2026-09-02,59,54,398,88
```

---

## Testing On An iPhone

Push notifications, secure cookies, and OAuth callbacks all require **HTTPS**, and a phone
cannot reach `localhost` on your computer.

1. Start the server, then open an HTTPS tunnel to it, for example
   `cloudflared tunnel --url http://localhost:3000`.
2. In `.env`, set `TRUST_PROXY=1` and `PUBLIC_ORIGIN` to the tunnel's `https://` address.
   Register that address's callback URLs with Whoop and Google as above.
3. Open the address in **Safari** on the iPhone, tap **Share**, then **Add to Home Screen**.
4. Launch Myaku **from the home screen icon**, then turn on reminders. iOS only allows web push
   for apps installed to the home screen, on iOS 16.4 or later.

Quick tunnels change address every time they start, and OAuth providers only accept redirect
URIs registered in advance. For repeated testing, use a tunnel with a fixed hostname.
