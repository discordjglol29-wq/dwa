# zon#999 Valorant stats site (Netlify)

Files: index.html (the site), netlify/functions/stats.js (reads your stats from the HenrikDev API), netlify.toml (settings).

## Put it online (free)
1. Get a HenrikDev API key (see docs.henrikdev.xyz or their Discord).
2. Make a free account at github.com, create a new repository, and upload everything in this folder.
3. Make a free account at netlify.com. Click Add new site > Import an existing project > GitHub, and pick that repository.
4. Leave the build command empty and press Deploy.
5. Open Site configuration > Environment variables and add:
   - HENRIK_API_KEY = your key
   - VALORANT_REGION = ap  (use na, eu or kr if that is your region)
6. Go to Deploys > Trigger deploy > Deploy site, so the variables are loaded.
7. Check it works: open your-site-address/api/stats. You should see your rank as text. Errors show there too.

After you play, refresh the site to see the new matches and rank change.
