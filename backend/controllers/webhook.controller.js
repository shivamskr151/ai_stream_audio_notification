// backend/controllers/webhook.controller.js
const { EventService } = require("../services/event.service");
const { broadcastEvent } = require("../lib/sse");


const eventService = new EventService();

exports.handleWebhook = async (req, res) => {
  try {
    const eventData = req.body;
    console.log("Received webhook data:", eventData);

    // Step 1: Save data to DB using EventService (handles absolute_bbox properly)
    const savedEvent = await eventService.create(eventData);
    console.log("Saved event:", savedEvent);

    // Step 2: Send data to SSE clients
    broadcastEvent(savedEvent);
    console.log("Broadcasted event to SSE clients");

    res.status(200).json({ success: true, message: "Webhook processed", savedEvent });
  } catch (error) {
    console.error("Webhook error:", error);
    console.error("Error details:", error.message, error.stack);
    res.status(500).json({ success: false, message: "Internal Server Error", error: error.message });
  }
};
