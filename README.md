# Soul + FaceSwap Generator

AI-powered image generator that combines **Higgsfield Soul** for stylized scene generation with **WaveSpeed Face Swap** to place your face in the result.

## How it works

1. **Upload your face** - A clear photo of your face
2. **Describe the scene** - Write a prompt for the style/scene you want
3. **Generate** - Soul creates the stylized image, then FaceSwap puts your face in it

## Setup

```bash
npm install
```

Create `.env` file:
```
WAVESPEED_API_KEY=your_api_key_here
```

Get your API key from [WaveSpeed AI](https://wavespeed.ai)

## Run

```bash
npm start
```

Open http://localhost:3000

## Tech Stack

- Express.js backend
- WaveSpeed AI API (Soul + Face Swap)
- Vanilla JS frontend

## API Endpoints

- `POST /api/upload` - Upload image to WaveSpeed
- `POST /api/generate` - Soul + FaceSwap pipeline
- `GET /api/result/:id` - Poll for result
