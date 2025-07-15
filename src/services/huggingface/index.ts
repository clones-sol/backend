import axios from 'axios';

const HUGGINGFACE_API_BASE_URL = 'https://huggingface.co/api';

/**
 * Validates a Hugging Face API key by making a call to the /whoami endpoint.
 * As per the spec, network errors or 5xx errors from Hugging Face will be treated as a "soft pass"
 * to avoid blocking users if the service is temporarily unavailable.
 * 
 * @param apiKey The Hugging Face API key to validate.
 * @returns A promise that resolves to true if the key is valid or if the validation service fails, and false only if the key is explicitly invalid (401).
 */
export const validateHuggingFaceApiKey = async (apiKey: string): Promise<boolean> => {
    if (!apiKey) {
        return false;
    }

    try {
        const response = await axios.get(`${HUGGINGFACE_API_BASE_URL}/whoami`, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
            },
            timeout: 7000, // 7-second timeout
        });

        // A 200 OK response means the key is valid.
        return response.status === 200;
    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 401) {
            // 401 Unauthorized specifically means the key is invalid. This is a hard fail.
            return false;
        }

        // For any other error (e.g., timeout, network issue, 5xx server error from HF),
        // we log the error but allow the process to continue.
        console.warn('Hugging Face API key validation could not be completed due to a service error. Proceeding with key storage.', axios.isAxiosError(error) ? error.message : 'Unknown error');
        return true;
    }
}; 