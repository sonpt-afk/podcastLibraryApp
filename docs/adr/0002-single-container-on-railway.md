# Single container on Railway, not Vercel

The app runs as one always-on container on Railway. Chapter generation and PDF rendering are 20-60s calls that fight serverless function limits, the sweeper runs in-process and needs a machine that never sleeps, and Vercel Hobby forbids commercial use while Pro costs $20/mo before any revenue. We give up zero-ops deploys and Vercel Blob (PDFs are not stored at all, see ADR-0003), and we own Dockerfile, restarts, and region choice (near Neon). The original plan assumed Vercel; do not "fix" the deployment back to it without revisiting these timeouts.
