#!/usr/bin/env node

// Simple test script to verify the MockServer fix
import { MockServer } from './dist/mock-server.js';

async function test() {
    console.log('Testing MockServer fix...');

    try {
        const mockServer = new MockServer({
            basePath: './test-data-fix',
            port: 5031,
            namespace: 'examples',
            tableName: 'responses'
        });

        console.log('MockServer created successfully');

        // Test storing a mock
        const response = {
            status: 200,
            headers: { 'content-type': 'application/json' },
            data: { id: 1, name: 'Test User' }
        };

        const filename = await mockServer.storeMock(
            'https://api.example.com/users/1',
            null,
            response,
            'getUser',
            'Test Mock'
        );

        console.log('Mock stored successfully:', filename);

        // Test listing mocks
        const mocks = await mockServer.listMocks();
        console.log('Listed mocks:', mocks.length);

        console.log('✅ MockServer fix verified successfully!');

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

test();
