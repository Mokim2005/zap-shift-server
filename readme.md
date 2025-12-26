# Zap Shift Server

This is the **backend server** for the Zap Shift Parcel Management System. A lightweight, fast, and fully Zapier-integrated REST API server built with Node.js + Express. It supports parcel booking, tracking, rider management, OTP verification, and automated pricing.

## 🚀 Features

- Role-based authentication (User, Rider, Admin)
- Automated parcel pricing calculation
- Real-time status updates and tracking
- OTP-based secure delivery confirmation
- Rider commission management (80% same city, 60% outside)
- Webhook support for Zapier integration
- Nationwide coverage (64 districts of Bangladesh)
- Payment gateway ready (bKash, Nagad, SSLCommerz placeholders)
- Data management with MongoDB + Mongoose

## 📦 Tech Stack

- **Backend**: Node.js + Express
- **Database**: MongoDB (with Mongoose ODM)
- **Authentication**: JWT
- **Validation**: Joi
- **OTP Service**: Twilio / local fallback
- **Logging**: Winston
- **Environment**: dotenv

## ⚙️ Installation & Setup

```bash
# Clone the repository
git clone https://github.com/Mokim2005/zap-shift-server
cd zap-shift-server

# Install dependencies
npm install

# Create .env file (sample provided below)
cp .env.example .env

# Start the server (development mode)
npm run dev