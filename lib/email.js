// lib/email.js
//
// Optional: emails you when a price drops, using EmailJS
// (https://www.emailjs.com) - a service designed specifically for sending
// email directly from client-side JS without needing your own backend or
// SMTP server. Free tier is plenty for personal use.
//
// This does nothing until you fill in emailConfig below. Until then,
// sendDropEmail() just returns immediately.
//
// Setup (takes about 5 minutes):
//   1. Create a free account at https://www.emailjs.com
//   2. Add an "Email Service" (e.g. connect your Gmail) - note the Service ID
//   3. Create an Email Template with variables like {{item_name}},
//      {{old_price}}, {{new_price}}, {{item_url}} - note the Template ID
//   4. Account > General > note your Public Key
//   5. Fill in the three values below.

const emailConfig = {
  serviceId: "",   // e.g. "service_abc1234"
  templateId: "",  // e.g. "template_xyz9876"
  publicKey: "",   // e.g. "AbCdEfGhIjKlMnOp"
  toEmail: "",     // the address you want notified, e.g. your own email
};

function isConfigured() {
  return emailConfig.serviceId && emailConfig.templateId && emailConfig.publicKey && emailConfig.toEmail;
}

export async function sendDropEmail(item, previousPrice) {
  if (!isConfigured()) return; // email feature not set up yet - silently skip

  const body = {
    service_id: emailConfig.serviceId,
    template_id: emailConfig.templateId,
    user_id: emailConfig.publicKey,
    template_params: {
      to_email: emailConfig.toEmail,
      item_name: item.name,
      old_price: previousPrice.toFixed(2),
      new_price: item.currentPrice.toFixed(2),
      item_url: item.url,
      item_image: item.image || "",
    },
  };

  const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`EmailJS send failed: ${res.status} ${text}`);
  }
}
