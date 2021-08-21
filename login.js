const axios = require('axios');

const LOGIN_URL = "https://account.menmastera.com/launcher";

let source = axios.CancelToken.source();

function login(username, password) {
    source = axios.CancelToken.source();

    return new Promise((resolve, reject) => {
        axios.post(LOGIN_URL + '/login', { username, password }, {
            headers: {'Content-Type': 'application/json'},
            cancelToken: source.token
        }).then((response) => {
            if(response.status === 201) {
                resolve(response.data);
            } else {
                reject("Received unexpected response: " + response.status);
            }
        }).catch((err) => {
            if(axios.isCancel(err)) {
                reject("request-cancel");
                return;
            }

            if(err.response) {
                switch(err.response.status) {
                    case 401: {
                        reject("Invalid username / password combination.");
                        break;
                    }
                    case 403: {
                        reject("Account not activated. Check your email inbox or SPAM folder to confirm your email address.");
                        break;
                    }
                    default: {
                        reject(err.response.status + ": " + err.response.statusText);
                    }
                }
            } else reject("Could not connect to login server. Please check your internet connection and try again.");
        });
    });
}

function logout(loginToken) {
    axios.delete(LOGIN_URL + '/logout', {
        headers: {'Authorization': 'Bearer ' + loginToken},
        validateStatus: (status) => status == 202
    }).catch((err) => {
        console.error(err.message);
    });
}

async function getServerInfo(loginToken) {
    source = axios.CancelToken.source();

    return new Promise((resolve, reject) => {
        axios.get(LOGIN_URL + '/getServerInfo', {
                transformResponse: (res) => res,
                headers: {'Authorization': 'Bearer ' + loginToken},
                cancelToken: source.token
            }).then((response) => {
                if(response.status === 200) {
                    resolve(response.data);
                } else {
                    reject("Received unexpected response: " + response.status);
                }
        }).catch((err) => {
            if(axios.isCancel(err)) {
                reject("request-cancel");
                return;
            }

            if(err.response) {
                switch(err.response.status) {
                    case 401: {
                        reject("Your automatic login token has expired. Please log in again.");
                        break;
                    }
                    case 403: {
                        reject("Your account has been banned.<br>Reason: " + err.response.data.toString());
                        break;
                    }
                    case 503: {
                        reject("The game is currently in maintenance mode.");
                        break;
                    }
                    default: {
                        reject(err.response.status + ": " + err.response.statusText);
                    }
                }
            } else reject("Could not connect to login server. Please check your internet connection and try again.");
        });
    });
}

function cancelAllRequests() {
    source.cancel('All requests cancelled by user.');
}

module.exports = { login, logout, getServerInfo, cancelAllRequests };