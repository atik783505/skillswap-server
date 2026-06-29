const express = require('express');
const cors = require('cors');
require('dotenv').config();
const app = express()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const { jwtVerify, createRemoteJWKSet } = require('jose-cjs');
const port = process.env.PORT

app.use(cors());
app.use(express.json());


const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});


const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: "Unauthorized: No token provided" });
    }
    const token = authHeader.split(" ")[1];
    try {
        const JWKS = createRemoteJWKSet(
            new URL(`${process.env.CLIENT_URL}/api/auth/jwks`)
        );
        const { payload } = await jwtVerify(token, JWKS);
        // console.log(payload)
        req.user = payload;
        next();
    } catch (error) {
        console.error("Token validation failed:", error.message);
        return res.status(401).json({ message: "Unauthorized: Invalid or expired token" });
    }
};

const clientVerify = async (req, res, next) => {
    const user = req.user
    if (user.role !== 'client') {
        return res.status(403).json({ message: "forbidden" });
    }
    next()
}
const freelancerVerify = async (req, res, next) => {
    const user = req.user
    if (user.role !== 'freelancer') {
        return res.status(403).json({ message: "forbidden" });
    }
    next()
}
const adminVerify = async (req, res, next) => {
    const user = req.user
    if (user.role !== 'admin') {
        return res.status(403).json({ message: "forbidden" });
    }
    next()
}

async function run() {
    try {

        // await client.connect();

        const database = client.db('skillswap')
        const taskscollection = database.collection('tasks')
        const proposalscollection = database.collection('proposals')
        const usersCollection = database.collection('user')
        const paymentsCollection = database.collection('payments')

        // await client.db("admin").command({ ping: 1 });

        // piblic
        app.get('/api/all-tasks', async (req, res) => {
            try {
                const { page = 1, limit = 9, search = '', category = '' } = req.query;
                const query = {};
                if (search) {
                    query.title = { $regex: search, $options: 'i' };
                }
                if (category) {
                    query.category = category;
                }
                const skip = (Number(page) - 1) * Number(limit);

                const result = await taskscollection.find(query)
                    .sort({ _id: -1 })
                    .skip(skip)
                    .limit(Number(limit))
                    .toArray();

                const totalTask = await taskscollection.countDocuments(query);
                const totalPage = Math.ceil(totalTask / Number(limit));

                res.send({
                    data: result,
                    totalPage: totalPage,
                    page: Number(page)
                });
            } catch (error) {
                res.status(500).send({ message: "Internal Server Error", error });
            }
        });
        app.get('/api/featured-tasks', async (req, res) => {
            try {
                const query = { status: 'open' };
                const result = await taskscollection
                    .find(query)
                    .sort({ createdAt: -1 })
                    .limit(4)
                    .toArray();

                res.status(200).send(result);
            } catch (error) {
                console.error("Error fetching featured tasks:", error);
                res.status(500).send({ success: false, message: "Internal Server Error", error });
            }
        });
        app.get('/api/freelancerInfo', async (req, res) => {
            const query = { role: 'freelancer' }
            const result = await usersCollection.find(query).toArray()
            res.send(result)
        })
        app.get('/api/freelancerInfo/:freelancerId', async (req, res) => {
            try {
                const { freelancerId } = req.params;

                const result = await usersCollection.aggregate([
                    { $match: { _id: new ObjectId(freelancerId), role: 'freelancer' } },

                    {
                        $lookup: {
                            from: "proposals",
                            let: { fId: { $toString: "$_id" } },
                            pipeline: [
                                { $match: { $expr: { $eq: ["$freelancerId", "$$fId"] } } },
                                {
                                    $addFields: {
                                        taskIdObj: { $toObjectId: "$taskId" }
                                    }
                                },
                                {
                                    $lookup: {
                                        from: "tasks",
                                        localField: "taskIdObj",
                                        foreignField: "_id",
                                        as: "taskDetails"
                                    }
                                },
                                { $unwind: "$taskDetails" },

                                { $match: { "taskDetails.status": "completed" } }
                            ],
                            as: "completedProposals"
                        }
                    },

                    {
                        $addFields: {
                            completedTasksCount: { $size: "$completedProposals" }
                        }
                    },
                    {
                        $project: {
                            completedProposals: 0
                        }
                    }
                ]).toArray();

                if (result.length === 0) {
                    return res.status(404).send({ success: false, message: "Freelancer not found" });
                }

                res.send(result[0]);

            } catch (error) {
                console.error("Error fetching freelancer full profile stats:", error);
                res.status(500).send({ success: false, message: "Internal server error" });
            }
        });
        app.get('/api/top-freelancers', async (req, res) => {
            try {
                const topFreelancers = await usersCollection.aggregate([
                    { $match: { role: 'freelancer' } },
                    {
                        $lookup: {
                            from: "proposals",
                            let: { fId: { $toString: "$_id" } },
                            pipeline: [
                                { $match: { $expr: { $eq: ["$freelancerId", "$$fId"] } } },
                                {
                                    $addFields: {
                                        taskIdObj: { $toObjectId: "$taskId" }
                                    }
                                },
                                {
                                    $lookup: {
                                        from: "tasks",
                                        localField: "taskIdObj",
                                        foreignField: "_id",
                                        as: "taskDetails"
                                    }
                                },
                                { $unwind: "$taskDetails" },
                                { $match: { "taskDetails.status": "completed" } }
                            ],
                            as: "completedProposals"
                        }
                    },
                    {
                        $addFields: {
                            completedTasksCount: { $size: "$completedProposals" },
                            skillsCount: {
                                $cond: {
                                    if: { $isArray: "$skills" },
                                    then: { $size: "$skills" },
                                    else: 0
                                }
                            }
                        }
                    },
                    {
                        $sort: {
                            completedTasksCount: -1,
                            skillsCount: -1
                        }
                    },
                    { $limit: 4 },
                    {
                        $project: {
                            completedProposals: 0,
                            skillsCount: 0
                        }
                    }
                ]).toArray();

                res.status(200).send(topFreelancers);
            } catch (error) {
                console.error("Error fetching top freelancers:", error);
                res.status(500).send({ success: false, message: "Internal server error", error: error.message });
            }
        });

        app.post('/api/tasks', verifyToken, clientVerify, async (req, res) => {
            const task = req.body
            task.createdAt = new Date();
            const result = await taskscollection.insertOne(task)
            res.send(result)
        })
        app.get('/api/tasks', verifyToken, clientVerify, async (req, res) => {
            const query = {}
            if (req.query.clientId) {
                query.clientId = req.query.clientId
            }
            const result = await taskscollection.find(query).toArray()
            res.send(result)
        })
        app.get('/api/tasks/:id', async (req, res) => {
            const { id } = req.params
            const result = await taskscollection.findOne({ _id: new ObjectId(id) })
            res.send(result)
        })
        app.delete('/api/tasks/:id', verifyToken, clientVerify, async (req, res) => {
            const { id } = req.params
            const query = { _id: new ObjectId(id) }
            const result = await taskscollection.deleteOne(query)
            res.send(result)
        })

        app.patch('/api/tasks/:id', verifyToken, clientVerify, async (req, res) => {
            try {
                const { id } = req.params;
                const updateData = req.body;
                delete updateData._id;
                delete updateData.status;

                const result = await taskscollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: updateData }
                );

                res.send(result);
            } catch (error) {
                console.error("Error updating task:", error);
                res.status(500).send({ success: false, message: "Internal server error" });
            }
        });

        app.post('/api/proposals', verifyToken, freelancerVerify, async (req, res) => {
            const proposals = req.body
            proposals.createdAt = new Date();
            const result = await proposalscollection.insertOne(proposals)
            res.send(result)
        })
        app.get('/api/proposals/:taskId', verifyToken, async (req, res) => {
            const { taskId } = req.params;
            const result = await proposalscollection.find({ taskId }).toArray();
            res.send(result);
        });
        app.post('/api/save-payment', verifyToken, clientVerify, async (req, res) => {
            try {
                const paymentData = req.body;
                const existingPayment = await paymentsCollection.findOne({
                    transaction_id: paymentData.transaction_id
                });

                if (existingPayment) {
                    return res.status(200).send({ success: true, message: "Payment already processed." });
                }
                paymentData.paid_at = new Date();
                await paymentsCollection.insertOne(paymentData);

                const updatedProposal = await proposalscollection.updateOne(
                    { _id: new ObjectId(paymentData.proposal_id) },
                    { $set: { status: 'accepted' } }
                );
                await proposalscollection.updateMany(
                    {
                        taskId: paymentData.task_id,
                        _id: { $ne: new ObjectId(paymentData.proposal_id) }
                    },
                    { $set: { status: 'rejected' } }
                );

                await taskscollection.updateOne(
                    { _id: new ObjectId(paymentData.task_id) },
                    { $set: { status: 'in progress' } }
                );

                res.status(201).send({ success: true, message: "Payment processed, proposal accepted, and others rejected" });
            } catch (error) {
                console.error("Error processing payment:", error);
                res.status(500).send({ success: false, message: "Failed to process payment" });
            }
        });
        app.patch('/api/proposals/complete-task', verifyToken, freelancerVerify, async (req, res) => {
            try {
                const { taskId, deliverable_url } = req.body;
                const result = await taskscollection.updateOne(
                    { _id: new ObjectId(taskId) },
                    {
                        $set: {
                            deliverable_url: deliverable_url,
                            status: 'completed'
                        }
                    }
                );

                if (result.matchedCount > 0) {
                    res.status(200).send({ success: true, message: "Task completed successfully" });
                } else {
                    res.status(404).send({ success: false, message: "Task not found" });
                }
            } catch (error) {
                console.error("Error completing task:", error);
                res.status(500).send({ success: false, message: "Internal server error" });
            }
        });
        app.get('/api/proposals/check/:freelancerId', async (req, res) => {
            const { freelancerId } = req.params;
            const { taskId } = req.query;
            try {

                const proposals = await proposalscollection.find({ freelancerId: freelancerId }).toArray();

                const isSubmitted = proposals.some(p => p.taskId === taskId);

                res.send({
                    submitted: isSubmitted,
                });

            } catch (error) {
                res.status(500).send({ error: "Something went wrong" });
            }
        });
        app.get('/api/my-proposals', verifyToken, freelancerVerify, async (req, res) => {
            const { freelancerEmail } = req.query;

            const result = await proposalscollection.aggregate([
                { $match: { freelancerEmail: freelancerEmail } },
                {
                    $addFields: {
                        taskIdObj: { $toObjectId: "$taskId" }
                    }
                },
                {
                    $lookup: {
                        from: "tasks",
                        localField: "taskIdObj",
                        foreignField: "_id",
                        as: "taskDetails"
                    }
                },
                { $unwind: "$taskDetails" }
            ]).toArray();

            res.send(result);
        });

        app.get('/api/my-proposals/:id', verifyToken, freelancerVerify, async (req, res) => {
            const { id } = req.params;
            const query = { _id: new ObjectId(id) };

            const result = await proposalscollection.aggregate([
                { $match: query },
                {
                    $addFields: {
                        taskIdObj: { $toObjectId: "$taskId" }
                    }
                },
                {
                    $lookup: {
                        from: "tasks",
                        localField: "taskIdObj",
                        foreignField: "_id",
                        as: "taskDetails"
                    }
                },
                { $unwind: "$taskDetails" }
            ]).toArray();

            if (result.length > 0) {
                res.send(result[0]);
            } else {
                res.status(404).send({ message: "Proposal not found" });
            }
        });
        app.get('/api/freelancer-earings', verifyToken, freelancerVerify, async (req, res) => {
            try {
                const { email } = req.query;

                if (!email) {
                    return res.status(400).send({ success: false, message: "Email query parameter is required" });
                }

                const query = { freelancer_email: email };

                const result = await paymentsCollection.aggregate([
                    {
                        $match: query
                    },

                    {
                        $lookup: {
                            from: "tasks",
                            let: { taskIdStr: "$task_id" },
                            pipeline: [
                                {
                                    $match: {
                                        $expr: {
                                            $eq: ["$_id", { $toObjectId: "$$taskIdStr" }]
                                        }
                                    }
                                },

                                { $project: { title: 1, clientName: 1, _id: 0 } }
                            ],
                            as: "taskDetails"
                        }
                    },
                    {
                        $unwind: {
                            path: "$taskDetails",
                            preserveNullAndEmptyArrays: true
                        }
                    },

                    {
                        $project: {
                            _id: 1,
                            client_email: 1,
                            freelancer_email: 1,
                            task_id: 1,
                            amount: 1,
                            transaction_id: 1,
                            payment_status: 1,
                            paid_at: 1,
                            task_title: { $ifNull: ["$taskDetails.title", "N/A"] },
                            client_name: { $ifNull: ["$taskDetails.clientName", "N/A"] }
                        }
                    },
                    {
                        $sort: { paid_at: -1 }
                    }
                ]).toArray();

                res.send(result);

            } catch (error) {
                console.error("Aggregation Error:", error);
                res.status(500).send({ success: false, message: "Internal server error" });
            }
        });
        app.get('/api/client-proposals/:clientId', verifyToken, clientVerify, async (req, res) => {
            const { clientId } = req.params;

            const result = await proposalscollection.aggregate([

                { $addFields: { taskIdObj: { $toObjectId: "$taskId" } } },
                {
                    $lookup: {
                        from: "tasks",
                        localField: "taskIdObj",
                        foreignField: "_id",
                        as: "taskDetails"
                    }
                },
                { $unwind: "$taskDetails" },


                { $match: { "taskDetails.clientId": clientId } },


                {
                    $lookup: {
                        from: "user",
                        localField: "freelancerEmail",
                        foreignField: "email",
                        as: "freelancerDetails"
                    }
                },
                {
                    $addFields: {
                        freelancerInfo: { $arrayElemAt: ["$freelancerDetails", 0] }
                    }
                },
                { $project: { freelancerDetails: 0 } }
            ]).toArray();

            res.send(result);
        });
        app.get('/api/users-data', verifyToken, adminVerify, async (req, res) => {
            const result = await usersCollection.find().toArray()
            res.send(result)
        })
        app.patch('/api/user-data/:id', verifyToken, adminVerify, async (req, res) => {
            try {
                const { id } = req.params;
                const { isBlocked } = req.body;

                const result = await usersCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { isBlocked: isBlocked } }
                );

                if (result.matchedCount === 0) {
                    return res.status(404).send({ message: "User not found" });
                }

                res.send({ success: true, message: "User status updated successfully" });
            } catch (error) {
                res.status(500).send({ message: "Internal server error" });
            }
        });
        app.delete('/api/manage-tasks/:id', verifyToken, adminVerify, async (req, res) => {
            const { id } = req.params
            const query = { _id: new ObjectId(id) }
            const result = await taskscollection.deleteOne(query)
            res.send(result)
        })
        app.get('/api/admin/stats', verifyToken, adminVerify, async (req, res) => {
            try {
                const totalUsers = await usersCollection.countDocuments();
                const totalTasks = await taskscollection.countDocuments();
                const inProgressTasks = await taskscollection.countDocuments({ status: 'in progress' });
                const stats = await paymentsCollection.aggregate([
                    {
                        $group: {
                            _id: null,
                            totalRevenue: { $sum: "$amount" }
                        }
                    }
                ]).toArray();

                const totalRevenue = stats.length > 0 ? stats[0].totalRevenue : 0;

                res.send({
                    totalUsers,
                    totalTasks,
                    inProgressTasks,
                    totalRevenue

                });
            } catch (error) {
                console.error("Error fetching stats:", error);
                res.status(500).send({ message: "Failed to fetch dashboard stats" });
            }
        });
        app.get('/api/admin/transactions', verifyToken, adminVerify, async (req, res) => {
            const result = await paymentsCollection.find().toArray()
            res.send(result)
        })


        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})