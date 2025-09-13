const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
// Osobny klient Stripe do trybu testowego (jeśli podany)
const stripeTest = require('stripe')(process.env.STRIPE_SECRET_KEY_TEST || process.env.STRIPE_SECRET_KEY);

// Inicjalizacja Supabase (preferuj SERVICE_KEY na backendzie)
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
);

const app = express();
app.use(cors());
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

// Mapowanie kursów na priceId Stripe (16 kursów + full_access) - LIVE MODE
const coursePriceIds = {
    1: 'price_1RtPFoJLuu6b086bmfvVO4G8', // Kinematyka
    2: 'price_1RtPGOJLuu6b086b1QN5l4DE', // Dynamika
    3: 'price_1Rgt0yJLuu6b086b115h7OXM', // Praca moc energia
    4: 'price_1RtPKTJLuu6b086b3wG0IiaV', // Bryła Sztywna
    5: 'price_1RtPKkJLuu6b086b2lfhBfDX', // Ruch Drgający
    6: 'price_1RtPL2JLuu6b086bLl03p2R9', // Fale Mechaniczne
    7: 'price_1RtPLlJLuu6b086bbJxG1bqw', // Hydrostatyka
    8: 'price_1RgqlFJLuu6b086bf2Wl2bUg', // Termodynamika
    9: 'price_1RtPMCJLuu6b086bV3Zk0il6', // Grawitacja i Astronomia
    10: 'price_1Rgt1HJLuu6b086bmNgENAIM', // Elektrostatyka
    11: 'price_1RtPNJJLuu6b086bBejuPL2T', // Prąd Elektryczny
    12: 'price_1RtPNdJLuu6b086bjn7p0Wsn', // Magnetyzm
    13: 'price_1RtPORJLuu6b086b1yxr0voQ', // Indukcja Elektromagnetyczna
    14: 'price_1Rgt1TJLuu6b086bNn14JbJa', // Fale Elektromagnetyczne i Optyka
    15: 'price_1Rgt1lJLuu6b086bk3TJqFzM', // Fizyka Atomowa
    16: 'price_1Rgt21JLuu6b086bTBuO2djx', // Fizyka Jądrowa i Relatywistyka
    17: 'price_1RtPPaJLuu6b086bdmWNAsGI' // Wszystkie materiały (full_access)
};

// Mapowanie priceId na course_id
const priceToCourseId = {
    'price_1RtPFoJLuu6b086bmfvVO4G8': 1, // Kinematyka
    'price_1RtPGOJLuu6b086b1QN5l4DE': 2, // Dynamika
    'price_1Rgt0yJLuu6b086b115h7OXM': 3, // Praca moc energia
    'price_1RtPKTJLuu6b086b3wG0IiaV': 4, // Bryła Sztywna
    'price_1RtPKkJLuu6b086b2lfhBfDX': 5, // Ruch Drgający
    'price_1RtPL2JLuu6b086bLl03p2R9': 6, // Fale Mechaniczne
    'price_1RtPLlJLuu6b086bbJxG1bqw': 7, // Hydrostatyka
    'price_1RgqlFJLuu6b086bf2Wl2bUg': 8, // Termodynamika
    'price_1RtPMCJLuu6b086bV3Zk0il6': 9, // Grawitacja i Astronomia
    'price_1Rgt1HJLuu6b086bmNgENAIM': 10, // Elektrostatyka
    'price_1RtPNJJLuu6b086bBejuPL2T': 11, // Prąd Elektryczny
    'price_1RtPNdJLuu6b086bjn7p0Wsn': 12, // Magnetyzm
    'price_1RtPORJLuu6b086b1yxr0voQ': 13, // Indukcja Elektromagnetyczna
    'price_1Rgt1TJLuu6b086bNn14JbJa': 14, // Fale Elektromagnetyczne i Optyka
    'price_1Rgt1lJLuu6b086bk3TJqFzM': 15, // Fizyka Atomowa
    'price_1Rgt21JLuu6b086bTBuO2djx': 16, // Fizyka Jądrowa i Relatywistyka
    'price_1RtPPaJLuu6b086bdmWNAsGI': 17 // Wszystkie materiały (full_access)
};

app.post('/api/create-checkout-session', async (req, res) => {
    const { userId, email, courseId, priceId } = req.body;
    if (!userId || !email || !courseId || !priceId) {
        return res.status(400).json({ error: 'Brak wymaganych danych.' });
    }
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card', 'blik', 'klarna'],
            mode: 'payment',
            customer_email: email,
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                },
            ],
            metadata: {
                userId,
                courseId
            },
            success_url: `${process.env.FRONTEND_URL}/?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.FRONTEND_URL}/kurs`,
        });
        res.json({ id: session.id });
    } catch (err) {
        console.error('Stripe error:', err);
        res.status(500).json({ error: 'Błąd Stripe: ' + err.message });
    }
});


// Webhook Stripe do obsługi udanych płatności
app.post('/api/webhook', async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
        console.log('Webhook received:', event.type);
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Obsługa udanych płatności
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        console.log('Processing completed session:', session.id);
        
        // Sprawdź czy sesja ma wymagane metadane
        if (!session.metadata || !session.metadata.userId) {
            console.error('Session missing required metadata:', session.metadata);
            return res.status(400).json({ error: 'Missing required metadata' });
        }
        
        try {
            // Pobierz szczegóły sesji z line_items
            const sessionWithLineItems = await stripe.checkout.sessions.retrieve(session.id, {
                expand: ['line_items', 'line_items.data.price']
            });
            const lineItems = sessionWithLineItems.line_items?.data || [];

            let courseIds = [];

            // Mapowanie po priceId
            if (lineItems.length > 0 && lineItems[0]?.price?.id) {
                const priceId = lineItems[0].price.id;
                console.log('Price ID from session:', priceId);
                
                const courseIdFromPrice = priceToCourseId[priceId];
                console.log('Mapped course ID:', courseIdFromPrice);

                if (courseIdFromPrice === 17) {
                    courseIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
                    console.log('Full access - adding all courses');
                } else if (courseIdFromPrice) {
                    courseIds = [courseIdFromPrice];
                    console.log('Single course access - adding course:', courseIdFromPrice);
                }
            }

            // Fallback: jeśli brak dopasowania po priceId, użyj metadata.courseId
            if (courseIds.length === 0 && session.metadata?.courseId) {
                const metaCourseId = session.metadata.courseId;
                console.log('Using metadata.courseId fallback:', metaCourseId);
                if (metaCourseId === 'full_access') {
                    courseIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
                } else if (!Number.isNaN(Number(metaCourseId))) {
                    courseIds = [Number(metaCourseId)];
                }
            }

            // Sprawdź czy użytkownik istnieje, jeśli nie - utwórz go
            const { data: existingUser, error: userError } = await supabase
                .from('users')
                .select('id')
                .eq('id', session.metadata.userId)
                .single();

            if (userError && userError.code !== 'PGRST116') {
                console.error('Error checking user:', userError);
            } else if (!existingUser) {
                // Utwórz użytkownika
                const { error: createUserError } = await supabase
                    .from('users')
                    .insert({
                        id: session.metadata.userId,
                        email: session.customer_email || session.customer_details?.email || 'unknown@example.com',
                        created_at: new Date().toISOString()
                    });

                if (createUserError) {
                    console.error('Error creating user:', createUserError);
                } else {
                    console.log('User created:', session.metadata.userId);
                }
            }

            // Dodaj wpisy do tabeli enrollments
            for (const courseId of courseIds) {
                const { error } = await supabase
                    .from('enrollments')
                    .upsert({
                        user_id: session.metadata.userId,
                        course_id: courseId,
                        access_granted: true,
                        enrolled_at: new Date().toISOString()
                    });

                if (error) {
                    console.error('Error adding enrollment for course', courseId, ':', error);
                } else {
                    console.log(`✅ Access granted for user ${session.metadata.userId} to course ${courseId}`);
                }
            }

            res.json({ received: true });
        } catch (error) {
            console.error('Error processing webhook:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    } else {
        console.log('Unhandled event type:', event.type);
        res.json({ received: true });
    }
});


// Sprawdź zmienne środowiskowe
console.log('Environment check:');
console.log('- SUPABASE_URL:', process.env.SUPABASE_URL ? '✓' : '✗ MISSING');
console.log('- SUPABASE_SERVICE_KEY:', process.env.SUPABASE_SERVICE_KEY ? '✓' : '✗ MISSING (using ANON_KEY)');
console.log('- STRIPE_SECRET_KEY:', process.env.STRIPE_SECRET_KEY ? '✓' : '✗ MISSING');
console.log('- STRIPE_SECRET_KEY_TEST:', process.env.STRIPE_SECRET_KEY_TEST ? '✓' : '✗ MISSING (using live key)');
console.log('- STRIPE_WEBHOOK_SECRET:', process.env.STRIPE_WEBHOOK_SECRET ? '✓' : '✗ MISSING');

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Backend listening on port ${PORT}`);
}); 