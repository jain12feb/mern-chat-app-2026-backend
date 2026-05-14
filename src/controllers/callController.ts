import { Request, Response } from "express";

export const getTurnCredentials = async (req: Request, res: Response) => {
  try {
    const TURN_TOKEN_ID = process.env.CLOUDFLARE_TURN_TOKEN_ID;
    const API_TOKEN = process.env.CLOUDFLARE_TURN_API_TOKEN;

    if (!TURN_TOKEN_ID || !API_TOKEN) {
      return res.status(500).json({ message: "Cloudflare TURN credentials are not configured on the server." });
    }

    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${TURN_TOKEN_ID}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: 86400 }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch TURN credentials: ${response.statusText}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    console.error("Error generating TURN credentials:", error);
    res.status(500).json({ message: error.message || "Server Error" });
  }
};
