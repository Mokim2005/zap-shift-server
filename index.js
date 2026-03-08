const express = require("express");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");
const stripe = require("stripe")(process.env.STRIPE_SECRET);

const app = express();
const port = process.env.PORT || 3000;

//firebase id varification
const admin = require("firebase-admin");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf8",
);
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

//zap_shift_user
//7z6GYyr4rEISeYXp
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ekpzegp.mongodb.net/?appName=Cluster0`;

function generateTrackingId() {
  const prefix = "ZAP";
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // 20250126
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();

  return `${prefix}-${date}-${random}`;
}

//middleware
app.use(express.json());
app.use(cors());

const verifyFBToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  const idToken = authHeader.split(" ")[1];

  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    console.error("Firebase verify error:", err);
    return res.status(401).send({ message: "unauthorized access" });
  }
};
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const db = client.db("zap_shift_db");
    const parcelsCollection = db.collection("parcels");
    const paymentCollection = db.collection("payments");
    const userCollection = db.collection("user");
    const ridersCollection = db.collection("riders");
    const trackingsCollection = db.collection("trackings");

    //middl admin before allowing admin activity
    //must be used verifyFBToken middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await userCollection.findOne(query);

      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    //verify rider access
    const verifyRider = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await userCollection.findOne(query);

      if (!user || user.role !== "rider") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    //riders  related api

    app.get("/riders", async (req, res) => {
      const { status, district, workStatus } = req.query;
      const query = {};
      if (req.query.status) {
        query.status = status;
      }

      if (district) {
        query.district = district;
      }

      if (workStatus) {
        query.workStatus = workStatus;
      }

      console.log(query);

      const cursor = ridersCollection.find(query);
      const result = await cursor.toArray();
      console.log(result);
      res.send(result);
    });

    app.post("/riders", async (req, res) => {
      const rider = req.body;
      rider.status = "pending";
      rider.createdAt = new Date();

      const result = await ridersCollection.insertOne(rider);
      res.send(result);
    });

    app.patch(
      "/riders/:id/role",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const status = req.body.status;
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            status: status,
            workStatus: "available",
          },
        };
        const result = await ridersCollection.updateOne(query, updatedDoc);

        if (status === "approve") {
          const email = req.body.email;
          const useQuery = { email };
          const updateUser = {
            $set: {
              role: "rider",
            },
          };
          const userResult = await userCollection.updateOne(
            useQuery,
            updateUser,
          );
        }

        res.send(result);
      },
    );

    app.delete("/riders/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await ridersCollection.deleteOne(query);
      res.send(result);
    });

    const logTracking = async (trackingId, status) => {
      const log = {
        trackingId,
        status,
        details: status.split("_").join(" "),
        createdAt: new Date(),
      };
      const result = await trackingsCollection.insertOne(log);
      return result;
    };

    //user related apis
    app.get("/users", verifyFBToken, async (req, res) => {
      try {
        const searchText = req.query.searchText?.trim() || "";

        let query = {};

        if (searchText) {
          query = {
            $or: [
              { displayName: { $regex: searchText, $options: "i" } },
              { email: { $regex: searchText, $options: "i" } },
              { role: { $regex: searchText, $options: "i" } },
            ],
          };
        }

        const users = await userCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();

        res.send(users);
      } catch (error) {
        console.error("User search error:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    app.patch(
      "/users/:id/role",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const roleInfo = req.body;
        const query = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            role: roleInfo.role,
          },
        };
        const result = await userCollection.updateOne(query, updatedDoc);
        res.send(result);
      },
    );

    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await userCollection.findOne(query);
      res.send({ role: user?.role || "user" });
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "user";
      user.createdAt = new Date();

      const email = user.email;
      const userExist = await userCollection.findOne({ email });

      if (userExist) {
        return res.send({ message: "user exists" });
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.get("/parcels/delivery-status/stats", async (req, res) => {
      const pipeline = [
        {
          $group: {
            _id: "$deliveryStatus",
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            status: "$_id",
            count: 1,
            // _id: 0
          },
        },
      ];
      const result = await parcelsCollection.aggregate(pipeline).toArray();
      res.send(result);
    });
    app.get("/rider/delivery-per-day", async (req, res) => {
      const email = req.query.email;

      const pipeline = [
        {
          $match: {
            riderEmail: email,
            deliveryStatus: "parcel_delivered",
          },
        },
        {
          $lookup: {
            from: "trackings",
            localField: "trackingId",
            foreignField: "trackingId",
            as: "parcel_trackings",
          },
        },
        { $unwind: "$parcel_trackings" },

        // Extract only delivery date (YYYY-MM-DD)
        {
          $project: {
            _id: 0,
            trackingId: 1,
            riderEmail: 1,
            deliveryDate: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$parcel_trackings.timestamp",
              },
            },
          },
        },

        // Group by date
        {
          $group: {
            _id: "$deliveryDate",
            totalDeliveries: { $sum: 1 },
          },
        },
      ];

      const result = await parcelsCollection.aggregate(pipeline).toArray();
      res.send(result);
    });

    //parcel api
    app.get("/parcels", async (req, res) => {
      const query = {};

      const { email, deliveryStatus } = req.query;

      if (email) {
        query.senderEmail = email;
      }

      if (deliveryStatus) {
        query.deliveryStatus = deliveryStatus;
      }
      const opotions = { sort: { createdAt: -1 } };

      const cursor = parcelsCollection.find(query, opotions);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/parcels/rider", async (req, res) => {
      const { riderEmail, deliveryStatus } = req.query;
      const query = {};
      if (riderEmail) {
        query.riderEmail = riderEmail;
      }
      if (deliveryStatus !== "parcel_delivered") {
        query.deliveryStatus = { $nin: ["parcel_delivered"] };
      } else {
        query.deliveryStatus = deliveryStatus;
      }

      const cursor = parcelsCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.patch("/parcels/:id/status", async (req, res) => {
      const { deliveryStatus, riderId, trackingId } = req.body;
      const query = { _id: new ObjectId(req.params.id) };
      const updatedDoc = {
        $set: {
          deliveryStatus: deliveryStatus,
        },
      };

      if (deliveryStatus === "parcel_delivered") {
        const riderQuery = { _id: new ObjectId(riderId) };
        const riderUpdateDoc = {
          $set: {
            workStatus: "available",
          },
        };

        const riderResult = await ridersCollection.updateOne(
          riderQuery,
          riderUpdateDoc,
        );
      }

      const result = await parcelsCollection.updateOne(query, updatedDoc);
      //log tracking
      logTracking(trackingId, deliveryStatus);
      res.send(result);
    });

    app.get("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelsCollection.findOne(query);
      res.send(result);
    });

    app.patch("/parcels/:id", async (req, res) => {
      const { riderId, riderName, trackingId, riderEmail } = req.body;
      const parcelId = req.params.id;

      // 1) Update Parcel Information
      const parcelQuery = { _id: new ObjectId(parcelId) };
      const parcelUpdateDoc = {
        $set: {
          deliveryStatus: "driver_assigned",
          riderId,
          riderName,
          riderEmail,
        },
      };

      const parcelResult = await parcelsCollection.updateOne(
        parcelQuery,
        parcelUpdateDoc,
      );

      // 2) Update Rider status (THIS IS THE FIX)
      const riderQuery = { _id: new ObjectId(riderId) };
      const riderUpdateDoc = {
        $set: {
          workStatus: "in_delivery",
        },
      };

      const riderResult = await ridersCollection.updateOne(
        riderQuery,
        riderUpdateDoc,
      );

      //log tracking
      logTracking(trackingId, "driver_assigned");

      res.send({
        parcelUpdated: parcelResult.modifiedCount,
        riderUpdated: riderResult.modifiedCount,
      });
    });

    app.post("/parcels", async (req, res) => {
      const parcel = req.body;
      console.log(parcel);
      const trackingId = generateTrackingId();
      //parcel created time

      parcel.createdAt = new Date();
      parcel.trackingId = trackingId;

      logTracking(trackingId, "parcel_created");

      const result = await parcelsCollection.insertOne(parcel);
      res.send(result);
    });

    app.delete("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelsCollection.deleteOne(query);
      res.send(result);
    });

    //payment related apis
    app.post("/create-cheakout-session", async (req, res) => {
      try {
        const paymentInfo = req.body;

        // Validate cost
        const amount = Number(paymentInfo.cost) * 100;
        if (!amount || isNaN(amount)) {
          return res.status(400).send({ error: "Invalid payment amount" });
        }

        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: "usd", // FIXED
                unit_amount: amount,
                product_data: {
                  name: paymentInfo.parcelName,
                },
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          metadata: {
            parcelId: paymentInfo.parcelId,
            parcelName: paymentInfo.parcelName,
          },
          customer_email: paymentInfo.senderEmail,

          success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-canceled`, // FIXED
        });

        res.send({ url: session.url });
      } catch (error) {
        console.log("Stripe Error:", error.message);
        res.status(500).send({ error: error.message });
      }
    });

    app.patch("/payment-success", async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const trackingId = generateTrackingId();
      // console.log("session retrieve ", session);

      const transactionId = session.payment_intent;
      const query = { transactionId: transactionId };
      const paymentExist = await paymentCollection.findOne(query);

      if (paymentExist) {
        return res.send({
          message: "already exists",
          transactionId,
          trackingId: paymentExist.trackingId,
        });
      }

      if (session.payment_status === "paid") {
        const id = session.metadata.parcelId;
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: {
            paymentStatus: "paid",
            deliveryStatus: "pending-pikup",
            trackingId: trackingId,
          },
        };

        const result = await parcelsCollection.updateOne(query, update);

        const payment = {
          amount: session.amount_total / 100,
          cyrrency: session.currency,
          customerEmail: session.customer_email,
          parcelId: session.metadata.parcelId,
          parcelName: session.metadata.parcelName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trackingId: trackingId,
        };
        if (session.payment_status === "paid") {
          const resultPayment = await paymentCollection.insertOne(payment);

          logTracking(trackingId, "parcel_paid");

          res.send({
            success: true,
            modifyParcel: result,
            trackingId: trackingId,
            transactionId: session.payment_intent,
            paymentInfo: resultPayment,
          });
        }
      }

      res.send({ success: false });
    });

    //payments related apis
    app.get("/payments", verifyFBToken, async (req, res) => {
      const email = req.query.email;

      const query = {};

      // console.log('headers',req.headers)

      if (email) {
        query.customerEmail = email;

        //cheack email address
        if (email !== req.decoded_email) {
          return res.status(403).send({ message: "forbidden access" });
        }
      }
      const cursor = paymentCollection.find(query).sort({ paidAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });

    //tracking related apis
    app.get("/tracking/:trackingId/logs", async (req, res) => {
      const trackingId = req.params.trackingId;
      const query = { trackingId };
      const result = await trackingsCollection.find(query).toArray();
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Zap shifting server is running!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
