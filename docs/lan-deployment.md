# CloudSentinel on a trusted LAN

Caddy v2 terminates HTTPS on TCP 443 at a single private IPv4 address. Node serves the React build, API and media from `127.0.0.1:3153`. Caddy admits only the interface subnet, disables the admin API and HTTP redirects, discards incoming forwarding headers, and sets its own forwarding headers. Node requires an exact HTTPS host and origin when provided, a loopback proxy connection and a fresh shared token. LAN sessions use separate `__Host-` cookies with Secure, HttpOnly and SameSite. Login throttling uses the client address set by Caddy. Audit entries retain the authenticated account.

## Prepare and start

1. Download the official Windows Caddy v2 archive for your architecture and check its hash using the algorithm in the release checksum list. Extract `caddy.exe` to a user-writable directory. [Official Caddy installation and releases](https://caddyserver.com/docs/install#static-binaries)
2. From the repository, run `npm run build`, then run the startup script with `-Plan` to find the URL, interface, subnet, network profile and certificate path. Stop the existing CloudSentinel terminal normally before switching to LAN mode if it owns TCP 3153. The script reuses the existing `.env` and SQLite path.
3. Confirm that this is a network you control and that Windows shows the adapter as **Private**. Manually change its profile only if appropriate and approved. The script refuses to start on Public or DomainAuthenticated profiles.

```powershell
.\scripts\start-lan.ps1 -Plan
.\scripts\start-lan.ps1 -LanIp 172.20.10.2 -CaddyPath .\results\caddy\bin\caddy.exe
.\scripts\test-lan.ps1
.\scripts\stop-lan.ps1
```

Substitute your detected IP and actual Caddy executable path. The example uses the address detected on this checkout. The script starts and stops both services and retains the CA and database. `npm start` remains the direct localhost workflow. For stable LAN access, reserve the IPv4 address in your network's DHCP configuration or pass `-DnsName` with a hostname that resolves to the chosen IPv4 address on every client. After an address change, stop and restart with the new address so Caddy issues a matching leaf certificate. Update any existing IP-scoped firewall rule.

## Windows Defender Firewall

After approval, run the following in elevated PowerShell on the host with your confirmed adapter, subnet, IP and executable path. The example mirrors the detected Wi-Fi interface. Skip creation if an equivalent scoped rule already exists.

```powershell
$caddyExe = (Resolve-Path .\results\caddy\bin\caddy.exe).Path
New-NetFirewallRule -Name 'CloudSentinel-LAN-HTTPS' -DisplayName 'CloudSentinel LAN HTTPS' `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 443 -Profile Private `
  -InterfaceAlias 'Wi-Fi' -LocalAddress '172.20.10.2' -RemoteAddress '172.20.10.0/28' -Program $caddyExe
```

Use `Disable-NetFirewallRule -Name 'CloudSentinel-LAN-HTTPS'` when you want to close the firewall exception. Keep TCP 3153, 4566 and 11434 loopback-only, and keep the CA storage and SQLite files private. The LAN launcher checks Floci and Ollama listeners and uses a Caddy subnet allowlist in addition to the firewall scope. [Microsoft firewall rule parameters](https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule)

## Trust the CA on authorized devices

Transfer only `data/lan-ca/pki/authorities/local/root.crt` via an authenticated channel. Compare the SHA-256 hash of the transferred file with `Get-FileHash -Algorithm SHA256 .\data\lan-ca\pki\authorities\local\root.crt` on the host. Keep all other files in `data/lan-ca` private, especially the root and intermediate keys.

- **Windows:** After approval, import the verified certificate with `Import-Certificate -FilePath .\root.crt -CertStoreLocation Cert:\CurrentUser\Root` and open the exact HTTPS URL in your browser.
- **Android:** Use the device's security settings to install a **CA certificate** from the verified file. Settings labels vary by device, and some managed browsers or applications restrict user-added roots. [Android certificate settings](https://support.google.com/pixelphone/answer/2844832)
- **iOS/iPadOS:** Install the certificate profile from Settings, then enable full trust for that root under **General → About → Certificate Trust Settings**. [Apple certificate trust settings](https://support.apple.com/en-us/102390)

`test-lan.ps1` passes the CA directly to Node’s HTTPS client for normal certificate and hostname verification. It works without changing the host trust store. After the firewall and trust steps, use a second authorized device on the same subnet to open the HTTPS URL and verify signup or login, carousel playback, fixture and Floci results, Ollama investigation when available, reload with the session intact, and logout. Guest Wi-Fi and hotspot client isolation can block peer-to-peer traffic.

## Google OAuth

Localhost continues using `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and the exact configured loopback redirect. LAN uses email/password by default. A LAN OAuth setup needs separate `LAN_GOOGLE_CLIENT_ID`, `LAN_GOOGLE_CLIENT_SECRET` and `LAN_GOOGLE_REDIRECT_URI`. Register the exact `https://your-owned-domain.example/api/auth/google/callback` URL on a Google Web application OAuth client, using a real eligible domain you control. Use that same hostname with `-DnsName` and resolve it privately to the chosen LAN address. Google rejects raw IPs for web redirect URIs outside its loopback exceptions. Registration and browser trust are prerequisites. [Google redirect URI rules](https://developers.google.com/identity/protocols/oauth2/web-server#uri-validation)

## Verification scope

The Windows host detected `172.20.10.2/28` on Wi-Fi with the Public profile, and an existing CloudSentinel process held TCP 3153. Local transport testing used Caddy on `https://127.0.0.1:8443` with an isolated CA and test database. It verified certificate and hostname checks, spoofed header stripping, signup, login, logout, Secure cookies, dashboard access, SPA routing and WebM delivery. Second-device browser and LAN firewall verification require the approved setup above.
