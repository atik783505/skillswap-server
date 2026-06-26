const express = require('express');
const cors = require('cors');
require('dotenv').config();
const app = express()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT

app.use(cors());
app.use(express.json());


const uri = process.env.MONGODB_URI;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});
async function run() {
    try {

        await client.connect();

        const database = client.db('skillswap')
        const taskscollection = database.collection('tasks')
        const proposalscollection = database.collection('proposals')
        const usersCollection = database.collection('user')
        const paymentsCollection = database.collection('payments')

        await client.db("admin").command({ ping: 1 });

        app.post('/api/tasks', async (req, res) => {
            const task = req.body
            task.createdAt = new Date();
            const result = await taskscollection.insertOne(task)
            res.send(result)
        })
        app.get('/api/tasks', async (req, res) => {
            const query = {}
            if (req.query.clientId) {
                query.clientId = req.query.clientId
            }
            const result = await taskscollection.find(query).toArray()
            res.send(result)
        })
        app.get('/api/all-tasks', async (req, res) => {
            const {page=1,limit=9} = req.query
            const skip = (Number(page)-1) * Number(limit)
            const result = await taskscollection.find().skip(skip).limit(Number(limit)).toArray()
            const totalTask = await taskscollection.countDocuments()
            const totalPage = Math.ceil(totalTask / limit)
            res.send({data:result,totalPage:totalPage,page:page})
        })
        app.get('/api/tasks/:id', async (req, res) => {
            const { id } = req.params
            const result = await taskscollection.findOne({ _id: new ObjectId(id) })
            res.send(result)
        })
        app.delete('/api/tasks/:id', async (req, res) => {
            const { id } = req.params
            const query = { _id: new ObjectId(id) }
            const result = await taskscollection.deleteOne(query)
            res.send(result)
        })

        app.patch('/api/tasks/:id', async (req, res) => {
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

        app.post('/api/proposals', async (req, res) => {
            const proposals = req.body
            proposals.createdAt = new Date();
            const result = await proposalscollection.insertOne(proposals)
            res.send(result)
        })
        app.get('/api/proposals/:taskId', async (req, res) => {
            const { taskId } = req.params;
            const result = await proposalscollection.find({ taskId }).toArray();
            res.send(result);
        });
        app.post('/api/save-payment', async (req, res) => {
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
        app.patch('/api/proposals/complete-task', async (req, res) => {
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
        app.get('/api/my-proposals', async (req, res) => {
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

        app.get('/api/my-proposals/:id', async (req, res) => {
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
        app.get('/api/client-proposals/:clientId', async (req, res) => {
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
        app.get('/api/users-data', async (req, res) => {
            const result = await usersCollection.find().toArray()
            res.send(result)
        })
        app.patch('/api/user-data/:id', async (req, res) => {
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
        app.delete('/api/manage-tasks/:id', async (req, res) => {
            const { id } = req.params
            const query = { _id: new ObjectId(id) }
            const result = await taskscollection.deleteOne(query)
            res.send(result)
        })
        app.get('/api/admin/stats', async (req, res) => {
            try {
                const totalUsers = await usersCollection.countDocuments();
                const totalTasks = await taskscollection.countDocuments();
                const inProgressTasks = await taskscollection.countDocuments({ status: 'in progress' });

                res.send({
                    totalUsers,
                    totalTasks,
                    inProgressTasks
                });
            } catch (error) {
                console.error("Error fetching stats:", error);
                res.status(500).send({ message: "Failed to fetch dashboard stats" });
            }
        });

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