import React, { Component } from "react";
import { Route, Routes } from "react-router-dom";
import Emotes from "./emotes";
import Alerts from "./alerts";

const ws = new WebSocket("ws://localhost:8000");

class App extends Component {
    state = {
        currentEmote: {},
        alertMessage: "",
    	streamBeastData: {
            type: 'none'
        },
    };

    componentDidMount() {
    	ws.onopen = () => {
            console.log("websocket client connected");
        };
    

        let streambeastMsgRunning = false;
        let streambeastMsgQueue = [];

        const streambeastMsgDuration = 9 * (1000);
        function handleStreambeast(self, data, hasData) {
            if(hasData){
                streambeastMsgQueue.push(data);
            }

            if(streambeastMsgQueue.length > 0 && !streambeastMsgRunning) {
                streambeastMsgRunning = true;

                let currData = streambeastMsgQueue.shift();
                self.setState({
                    streamBeastData: currData,
                });

                console.log('new message', currData)

                setTimeout(function () {
                    // Reset
                    self.setState({
                        streamBeastData: {
                            type: 'none'
                        },
                    });

                    // Delay between Alerts
                    setTimeout(function () {
                        streambeastMsgRunning = false;
                        handleStreambeast(self, '', false)
                    }, 1000);
                }, streambeastMsgDuration);
            }
        }

        let alertRunning = false;
        let alertQueue = [];

        function alert(self, message) {
            if (message !== "") {
                alertQueue.push(message);
            }

            if (alertQueue.length > 0 && !alertRunning) {
                alertRunning = true;

                let alertMessage = alertQueue.shift();

                self.setState({
                alertMessage: alertMessage,
                });
                // Reset after 5 seconds
                setTimeout(function () {
                    //Start the timer
                    self.setState({
                        alertMessage: "",
                    });

                    // Delay between Alerts
                    setTimeout(function () {
                        alertRunning = false;
                        alert(self, "");
                    }, 1000);
                }, 5000);
            }
        }

        function handleCheer(self, data) {
            let alertMessage = data.isAnon ? "An Anonymous Cheerer " : data.username;
            alertMessage = " just Cheered " + data.amount + " Bits!";
            alert(self, alertMessage);
        }

        function handleGifted(self, data) {
            let alertMessage = data.isAnon ? "An Anonymous Gifter " : data.username;
            alertMessage += " just gifted " + data.amount;

            let subTier = data.tier / 1000;
            if (subTier > 1) {
                alertMessage += " tier " + subTier;
            }

            if (data.amount === 1) {
                alertMessage += " sub!";
            } else {
                alertMessage += "subs!";
            }

            alertMessage += "!";

            alert(self, alertMessage);
        }

        function handleSubscriber(self, data) {
            let alertMessage = data.username + " just subscribed";

            let subTier = data.tier / 1000;
            if (subTier > 1) {
                alertMessage += " at tier " + subTier;
            }

            if (data.duration > 1) {
                alertMessage += " for " + data.duration + " months";
            }

            alertMessage += "!";

            alert(self, alertMessage);
        }

        function handleFollower(self, data) {
            let alertMessage = data.username + " followed the stream!";
            alert(self, alertMessage);
        }

        function handleShowEmote(self, data) {
            self.setState({
                currentEmote: data,
            });
            // Reset after 5 seconds
            setTimeout(function () {
                //Start the timer
                self.setState({
                currentEmote: {},
                });
            }, 5000);
        }

        ws.onmessage = (message) => {
            let data = JSON.parse(message.data);
            console.log("new message", data);
            // Show emote
            if (data["type"] === "showemote") {
                handleShowEmote(this, data);
            }
            // New Follower
            else if (data["type"] === "follow") {
                handleFollower(this, data);
            }
            // New Subscriber
            else if (data["type"] === "subscribe") {
                handleSubscriber(this, data);
            }
            // Gifted Subscribers
            else if (data["type"] === "gifted") {
                handleGifted(this, data);
            }
            // Cheer
            else if (data["type"] === "cheer") {
                handleCheer(this, data);
            }
            // Stream beast message
            else if (data["type"] === "streambeast") {
                handleStreambeast(this, data, true);
            }
        };
    }

    render() {
        return (
        <Routes>
            <Route
            path="/emotes"
            element={<Emotes emoteData={this.state.currentEmote} />}
            />
            <Route
            path="/alerts"
            element={<Alerts alertMessage={this.state.alertMessage} streambeastData={this.state.streamBeastData} />}
            />
        </Routes>
        );
    }
}

export default App;
